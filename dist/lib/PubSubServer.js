"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var Ttimer = turbine.tools.Ttimer;
const ChannelsManager_1 = require("./ChannelsManager");
const Client_1 = require("./Client");
const uuid = require("uuid");
const ws = require("ws");
const sockjs = require("sockjs");
const express = require("express");
const bodyParser = require("body-parser");
const Promise = require("bluebird");
class PubSubServer extends turbine.services.TbaseService {
    constructor(name, server, config) {
        super(name, config);
        this.clients = [];
        this.websocketServer = null;
        this.httpServer = server;
        this.app = express();
        this.app.use(bodyParser.json({
            limit: '50mb'
        }));
        this.httpServer.use(this.config.apiPath, this.app);
        this.cleanClientsTimer = new Ttimer({ delay: this.config.clientCleanInterval * 1000 });
        this.cleanClusterClientsTimer = new Ttimer({ delay: this.config.clientCleanInterval * 1000 });
        this._channelsManager = new ChannelsManager_1.ChannelsManager(this);
        this.logger.info("PubSubServer created active=" + this.active);
    }
    getDefaultConfig() {
        return {
            "active": true,
            "apiPath": "/api",
            "prefix": "/websocket",
            "executionPolicy": "one_per_process",
            "useSockjs": false,
            "clientCleanInterval": 60,
            "clientCleanTimeout": 600
        };
    }
    start() {
        super.start();
        this.cleanClientsTimer.on(Ttimer.ON_TIMER, this.onCleanClientsTimer, this);
        this.cleanClusterClientsTimer.on(Ttimer.ON_TIMER, this.onCleanClusterClientsTimer, this);
        this.cleanClientsTimer.start();
        if (this.config.useSockjs) {
            this.logger.info("USING SOCKJS");
            this.websocketServer = sockjs.createServer({
                websocket: true,
                log: this.onSockLog.bind(this)
            });
            this.websocketServer.installHandlers(this.httpServer.server, {
                prefix: this.config.prefix,
                disconnect_delay: 5000,
                response_limit: 128,
                heartbeat_delay: 50000
            });
        }
        else {
            this.logger.info("USING WebSocketServer");
            this.websocketServer = new ws.Server({
                server: this.httpServer.server,
                perMessageDeflate: false,
                path: this.config.prefix,
                verifyClient: function (info) {
                    return true;
                }
            });
        }
        this.websocketServer.on('connection', this.onConnection.bind(this));
        this.initRoutes();
        var sub = app.ClusterManager.getNewClient();
        sub.on("message", this.onRedisPubSubMessage.bind(this));
        sub.subscribe("pub-sub-messages");
        sub.subscribe("direct-messages");
        app.ClusterManager.on("ISMASTER_CHANGED", this.onIsMasterChanged, this);
    }
    stop() {
        this.eachClient(function (c) {
            c.free();
        });
        this._channelsManager.stop();
        this.cleanClientsTimer.stop();
        this.cleanClusterClientsTimer.stop();
        app.ClusterManager.off("ISMASTER_CHANGED", this.onIsMasterChanged);
        this.cleanClientsTimer.off(Ttimer.ON_TIMER, this.onCleanClientsTimer);
        this.cleanClusterClientsTimer.off(Ttimer.ON_TIMER, this.onCleanClusterClientsTimer);
    }
    onIsMasterChanged(e) {
        if (e.data) {
            this.cleanClusterClientsTimer.start();
            this.logger.info("cleanClusterClientsTimer démarré");
        }
        else {
            this.cleanClusterClientsTimer.stop();
            this.logger.info("cleanClusterClientsTimer arrêté");
        }
    }
    flatify() {
        return new Promise(function (resolve, reject) {
            var r = {
                _channelsManager: null,
                clusterConnexions: null
            };
            this._channelsManager.flatify()
                .then(function (result) {
                r._channelsManager = result;
                return this.getClusterConnexions();
            }.bind(this))
                .then(function (result) {
                r.clusterConnexions = result;
                resolve(r);
            }.bind(this));
        }.bind(this));
    }
    getClusterConnexions() {
        return new Promise(function (resolve, reject) {
            app.ClusterManager.getClient().hgetall("clientsConnexions", function (err, result) {
                if (err) {
                    reject(err);
                }
                else {
                    var r = {};
                    for (var k in result) {
                        try {
                            var connexion = JSON.parse(result[k]);
                            r[k] = connexion;
                        }
                        catch (err) {
                            this.logger.error("getClusterConnexions: result=", result);
                        }
                    }
                    resolve(r);
                }
            }.bind(this));
        }.bind(this));
    }
    onSockLog(severity, message) {
        if (severity == "error")
            console.log(message);
    }
    getChannelsManager() {
        return this._channelsManager;
    }
    sendChannelEvent(type, channelName, DBClient) {
        var message = {
            type: 'channel_event',
            channel: channelName,
            payload: {
                type: type,
                client: DBClient
            }
        };
        this.broadcast(message);
    }
    onCleanClusterClientsTimer() {
        var activeConnexions = {};
        var inactiveConnexions = {};
        var activeMessagesQueues = {};
        this.getClusterConnexions()
            .then(function (result) {
            var now = new Date().getTime() / 1000;
            for (var connId in result) {
                var connexion = result[connId];
                var diffSec = null;
                if (typeof connexion.lastActivityDate == "number")
                    diffSec = now - (connexion.lastActivityDate / 1000);
                if ((diffSec === null) || (diffSec > this.config.clientCleanTimeout)) {
                    this.logger.info("Suppression connexion dans REDIS: " + connId);
                    app.ClusterManager.getClient().hdel("clientsConnexions", connId);
                    inactiveConnexions[connId] = connexion;
                }
                else {
                    activeConnexions[connId] = connexion;
                }
            }
            return activeConnexions;
        }.bind(this))
            .then(function (result) {
            this.logger.debug("activeConnexions ", activeConnexions);
            return app.ClusterManager.getClient().hgetall("subscriptions");
        }.bind(this))
            .then(function (result) {
            var r = {};
            var promises = [];
            for (var key in result) {
                var sub = result[key];
                var item = JSON.parse(result[key]);
                var channelName = item.channelName;
                var messagesQueuesId = channelName + "_" + item.cid + "_messages_queue";
                var connId = key.leftOf("_");
                if (!connId)
                    this.logger.warn("connId non défini: key=" + key);
                if (!connId || !activeConnexions[connId]) {
                    promises.push(app.ClusterManager.getClient().hdel("subscriptions", key));
                    this.logger.debug("Suppression subscription dans REDIS: " + key);
                    promises.push(app.ClusterManager.getClient().del(messagesQueuesId));
                    if (inactiveConnexions[connId]) {
                        var client = inactiveConnexions[connId].client;
                        this.sendChannelEvent("unsubscribe", channelName, client);
                    }
                }
                else {
                    activeMessagesQueues[messagesQueuesId] = true;
                }
            }
            return Promise.all(promises);
        }.bind(this))
            .then(function (deleteResult) {
            return app.ClusterManager.getClient().keys(app.ClusterManager.keyPrefix + "*_messages_queue");
        }.bind(this))
            .then(function (results) {
            var promises = [];
            for (var i = 0; i < results.length; i++) {
                var key = results[i];
                var messagesQueuesId = key.rightOf(app.ClusterManager.keyPrefix);
                if (typeof activeMessagesQueues[messagesQueuesId] == "undefined") {
                    this.logger.info("Suppression clef " + key);
                    promises.push(app.ClusterManager.getClient().del(messagesQueuesId));
                }
            }
            return Promise.all(promises);
        }.bind(this))
            .then(function (result) {
            this.logger.info("Succès onCleanClusterClientsTimer");
        }.bind(this))
            .catch(function (err) {
            this.logger.error("onCleanClusterClientsTimer: ", err);
        }.bind(this));
    }
    removeMessagesQueues() {
        return app.ClusterManager.getClient().keys("*_messages_queue");
    }
    onCleanClientsTimer(evt) {
        var now = new Date().getTime() / 1000;
        var connectedClients = 0;
        var toDelete = [];
        for (var i in this.clients) {
            var c = this.clients[i];
            if (c == null) {
                this.logger.warn(i + " => NULL client");
                toDelete.push(i);
            }
            else {
                if (c.conn == null) {
                    this.logger.debug(i + " => client.conn = NULL, clientId=" + c.id);
                    var diffSec = null;
                    if (typeof c.lastActivityDate == "number")
                        diffSec = now - (c.lastActivityDate / 1000);
                    if ((diffSec === null) || (diffSec > this.config.clientCleanTimeout)) {
                        c.free();
                        toDelete.push(i);
                    }
                }
                else {
                    c.touchClusterClient();
                    if (c.id) {
                        this.logger.debug(i + " => client authenticated, clientId=" + c.id);
                        connectedClients++;
                    }
                    else {
                        this.logger.debug(i + " => client not authenticated");
                    }
                }
            }
        }
        for (var j = 0; j < toDelete.length; j++) {
            delete this.clients[toDelete[j]];
        }
        this.logger.info("Worker " + process.pid + ": Clients connected:" + connectedClients + ", supprimés:" + toDelete.length);
    }
    eachClient(callback) {
        var clients = this.clients.sort(function (a, b) {
            if (a.index > b.index)
                return 1;
            else if (a.index < b.index)
                return -1;
            else
                return 0;
        });
        for (var i in clients) {
            var c = this.clients[i];
            if (c.conn != null)
                callback(c);
        }
    }
    removeClient(client) {
        var total = 0;
        var removed = 0;
        for (var i in this.clients) {
            total++;
            if (this.clients[i] == client) {
                this.clients[i].free();
                delete this.clients[i];
                removed++;
            }
        }
        this.logger.debug("Nombre de clients: " + (total - removed));
        return removed;
    }
    getUserSession(sid) {
        return app.ClusterManager.getClient().hget("session.ctop", sid).then(function (session) {
            if (session)
                return JSON.parse(session);
            else
                return null;
        })
            .catch(function (err) {
            this.logger.error("getUserSession", err);
            throw err;
        }.bind(this));
    }
    onConnection(conn, req) {
        var cookieHeader = null;
        if (!this.config.useSockjs) {
            cookieHeader = req.headers.cookie;
        }
        else {
            cookieHeader = conn._session.recv.ws._stream._readableState.pipes._driver._request.headers.cookie;
        }
        if (cookieHeader) {
            var cookies = {};
            cookieHeader.split(';').forEach(function (cookie) {
                var parts = cookie.split('=');
                cookies[parts.shift().trim()] = decodeURI(parts[0]);
            });
            this.getUserSession(cookies["ctop"]).then(function (session) {
                var username = null;
                if ((session != null) && (session.user_name))
                    username = session.user_name;
                this.logger.info("Nouvelle connexion : session:", username);
            }.bind(this), function (err) {
                this.logger.error(err);
            }.bind(this));
        }
        if (!this.config.useSockjs)
            conn.id = uuid.v4();
        var client = new Client_1.Client(this, conn, { useSockjs: this.config.useSockjs });
        this.clients[conn.id] = client;
        client.on("CLOSE", this.onCloseClient.bind(this));
        client.on("DESTROY", this.onDestroyClient.bind(this));
        client.flatify().then(function (result) {
            app.ClusterManager.getClient().hset("clientsConnexions", conn.id, JSON.stringify(result));
        }.bind(this));
    }
    onDestroyClient(e) {
        if (e.currentTarget.conn != null)
            this.logger.debug("onDestroyClient " + e.currentTarget.id + ", connId=" + e.currentTarget.conn.id);
        else
            this.logger.debug("onDestroyClient " + e.currentTarget.id + ", connId=null");
    }
    onCloseClient(e) {
        var id = e.currentTarget.id;
        this.logger.debug("onCloseClient " + id);
        app.ClusterManager.getClient().hdel("clientsConnexions", e.data.connId);
    }
    getClientsById(id) {
        var r = [];
        if (id != null)
            for (var i in this.clients) {
                var c = this.clients[i];
                if (c.id == id) {
                    r.push(c);
                }
            }
        return r;
    }
    getClientsByUsername(username) {
        var r = [];
        if (username != null)
            for (var i in this.clients) {
                var c = this.clients[i];
                if (c.getUserName() == username)
                    r.push(c);
            }
        return r;
    }
    onRedisPubSubMessage(channel, data) {
        var data = JSON.parse(data);
        if (channel == "pub-sub-messages") {
            this._channelsManager.broadcast(data);
        }
        else if (channel == "direct-messages") {
            if (data.clientsId)
                this.sendMessagesToLocalClients(data.clientsId, data.messages);
            else if (data.userNames)
                this.sendMessagesToLocalUsersNames(data.userNames, data.messages);
            else
                this.logger.error("onRedisPubSubMessage : direct-messages sans 'clientsId' ni 'userNames'");
        }
        else {
            this.logger.error("onRedisPubSubMessage : channel '" + channel + "' is unknown");
        }
    }
    broadcast(messages, exclude = null) {
        if (typeof messages.push != "function")
            messages = [messages];
        this._channelsManager.publish(messages);
    }
    sendToUsers(userNames, messages) {
        if (typeof messages.push == "undefined")
            messages = [messages];
        var data = {
            userNames: userNames,
            messages: messages
        };
        app.ClusterManager.getClient().publish("direct-messages", JSON.stringify(data));
    }
    sendMessagesToLocalUsersNames(userNames, messages) {
        this.logger.debug("sendMessagesToLocalUsersNames " + userNames);
        if (typeof userNames == "string") {
            if (userNames != "*") {
                userNames = [userNames];
            }
            else {
                this.sendMessagesToLocalClients("*", messages);
            }
        }
        for (var i = 0; i < userNames.length; i++) {
            var username = userNames[i];
            var clients = this.getClientsByUsername(username);
            for (var j = 0; j < clients.length; j++) {
                clients[j].sendMessages(messages);
            }
        }
    }
    sendMessagesToLocalClients(clientsId, messages) {
        this.logger.debug("sendMessagesToLocalClients " + id);
        if (typeof clientsId == "string") {
            if (clientsId != "*") {
                clientsId = [clientsId];
            }
            else {
                clientsId = [];
                this.eachClient(function (c) {
                    if (c.id)
                        clientsId.push(c.id);
                });
            }
        }
        for (var i = 0; i < clientsId.length; i++) {
            var id = clientsId[i];
            var clients = this.getClientsById(id);
            for (var j = 0; j < clients.length; j++) {
                var client = clients[j];
                client.sendMessages(messages);
            }
        }
    }
    disconnectClient(id) {
        var clients = this.getClientsById(id);
        for (var j = 0; j < clients.length; j++) {
            var client = clients[j];
            client.disconnect();
        }
    }
    processBeforeRequest(req, res, next) {
        return true;
    }
    initRoutes() {
        this.app.post('/topics/sendMessageToUsers', (req, res, next) => {
            this.logger.debug("sendMessageToUsers");
            if (!this.processBeforeRequest(req, res, next))
                return;
            var messages = req.body;
            var type = 'user_message';
            for (var i = 0; i < messages.length; i++) {
                var message = messages[i];
                if ((typeof message.userNames == "undefined") || (typeof message.userNames.push != "function"))
                    this.logger.warn("sendMessageToUsers userNames is not a array");
                var data = {
                    userNames: message.userNames,
                    messages: message
                };
                this.sendToUsers(data.userNames, data.messages);
            }
            res.status(201).send(messages);
        });
        this.app.post('/topics/publish', (req, res, next) => {
            if (!this.processBeforeRequest(req, res, next))
                return;
            var type = 'publish';
            var messages = req.body;
            for (var i = 0; i < messages.length; i++)
                messages[i].type = "publish";
            this.broadcast(messages);
            res.status(200).send(messages);
        });
        this.app.get('/check', (req, res, next) => {
            if (!this.processBeforeRequest(req, res, next))
                return;
            res.status(200).send({
                exitCode: 0,
                message: "OK"
            });
        });
        this.app.get('/stat', (req, res, next) => {
            if (!this.processBeforeRequest(req, res, next))
                return;
            res.status(200).send({});
        });
        this.app.get('/getJson', (req, res, next) => {
            if (!req["session"]) {
                return next(new Error('oh no'));
            }
            if (!this.processBeforeRequest(req, res, next))
                return;
            this.flatify().then(function (result) {
                res.status(200).send(result);
            });
        });
        this.app.get('/getClusterConnexions', (req, res, next) => {
            if (!this.processBeforeRequest(req, res, next))
                return;
            this.getClusterConnexions().then(function (result) {
                res.status(200).send(result);
            }, function (err) {
                res.status(500).send(err.toString());
            });
        });
    }
}
exports.PubSubServer = PubSubServer;
//# sourceMappingURL=PubSubServer.js.map