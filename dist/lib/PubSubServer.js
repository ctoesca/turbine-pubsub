"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var Tevent = turbine.events.Tevent;
var Ttimer = turbine.tools.Ttimer;
const ChannelsManager_1 = require("./ChannelsManager");
const Client_1 = require("./Client");
const PurgeService_1 = require("./PurgeService");
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
        this.authenticatedClients = new Map();
        this.httpServer = server;
        this.app = express();
        this.app.use(bodyParser.json({
            limit: '50mb'
        }));
        this.httpServer.use(this.config.apiPath, this.app);
        this.processTimer = new Ttimer({ delay: 60 * 1000 });
        this.clusterTimer = new Ttimer({ delay: 60 * 1000 });
        this._channelsManager = new ChannelsManager_1.ChannelsManager(this);
        this.purgeService = new PurgeService_1.PurgeService(this);
        this.logger.info("PubSubServer created active=" + this.active + ", path=" + this.config.apiPath);
        this.purgeService.raz();
    }
    canSubscribe(client, channelName) {
        return Promise.resolve(true);
    }
    getDefaultConfig() {
        return {
            "active": true,
            "apiPath": "/api",
            "prefix": "/websocket",
            "executionPolicy": "one_per_process",
            "useSockjs": false
        };
    }
    start() {
        super.start();
        this.processTimer.on(Ttimer.ON_TIMER, this.onProcessTimer, this);
        this.clusterTimer.on(Ttimer.ON_TIMER, this.onClusterTimer, this);
        this.processTimer.start();
        if (this.config.useSockjs) {
            this.logger.warn("USING SOCKJS");
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
        sub.subscribe("cluster-action");
        app.ClusterManager.on("ISMASTER_CHANGED", this.onIsMasterChanged, this);
    }
    stop() {
        this.eachClient(function (c) {
            c.free();
        });
        this._channelsManager.stop();
        this.processTimer.stop();
        this.clusterTimer.stop();
        app.ClusterManager.off("ISMASTER_CHANGED", this.onIsMasterChanged);
        this.processTimer.off(Ttimer.ON_TIMER, this.onProcessTimer);
        this.clusterTimer.off(Ttimer.ON_TIMER, this.onClusterTimer);
    }
    onIsMasterChanged(e) {
        if (e.data) {
            this.clusterTimer.start();
            this.logger.info("clusterTimer démarré");
        }
        else {
            this.clusterTimer.stop();
            this.logger.info("clusterTimer arrêté");
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
        return app.ClusterManager.getClient().hgetall("clientsConnexions")
            .then(results => {
            var r = {};
            for (var k in results) {
                try {
                    var connexion = JSON.parse(results[k]);
                    r[k] = connexion;
                }
                catch (err) {
                    this.logger.error("getClusterConnexions: result=", results);
                }
            }
            return r;
        });
    }
    getClusterClients() {
        return app.ClusterManager.getClient().hgetall("clients")
            .then(results => {
            var r = {};
            for (var k in results) {
                try {
                    var connexion = JSON.parse(results[k]);
                    r[k] = connexion;
                }
                catch (err) {
                    this.logger.error("getClusterClients: result=", results);
                }
            }
            return r;
        });
    }
    getClusterClient(id) {
        return app.ClusterManager.getClient().hget("clients", id)
            .then(result => {
            let r = null;
            if (result) {
                r = JSON.parse(result);
            }
            return r;
        });
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
                type: type
            }
        };
        if (typeof DBClient == "object")
            message.payload.client = DBClient;
        else
            message.payload.clientId = DBClient;
        this.publish(message);
    }
    onClusterTimer() {
        var activeConnexions = {};
        var inactiveConnexions = {};
        var activeMessagesQueues = {};
        this.purgeService.purgeRedisConnections()
            .then(() => {
            return this.purgeService.purgeRedisClients();
        })
            .then(() => {
            return this.purgeService.purgeRedisSubscriptions();
        })
            .then(() => {
            return ChannelsManager_1.ChannelsManager.purgeChannelsInRedis();
        })
            .then(function (result) {
            this.logger.debug("Succès purge cluster");
        }.bind(this))
            .catch(function (err) {
            this.logger.error("onClusterTimer: ", err);
        }.bind(this));
    }
    onProcessTimer(evt) {
        this.purgeService.destroyOldClients();
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
    onConnection(conn, req) {
        if (this.config.useSockjs)
            req = conn._session.recv.ws._stream._readableState.pipes._driver._request;
        app.getUserSession(req)
            .then((session) => {
            if (!this.config.useSockjs)
                conn.id = uuid.v4();
            var client = new Client_1.Client(this, conn, {
                useSockjs: this.config.useSockjs,
                session: session,
                req: req
            });
            this.clients[conn.id] = client;
            this.dispatchEvent(new Tevent("CLIENT_CONNECTED", client));
            client.on("CLOSE", this.onCloseClient, this);
            client.on("DESTROY", this.onDestroyClient, this);
            client.on("AUTHENTICATED", this.onClientAuth, this);
            client.flatify().then(function (result) {
                app.ClusterManager.getClient().hset("clientsConnexions", conn.id, JSON.stringify(result));
            }.bind(this));
        })
            .catch(err => {
            this.logger.error(err);
        });
    }
    onClientAuth(e) {
        this.authenticatedClients.set(e.currentTarget.id, e.currentTarget);
        this.dispatchEvent(new Tevent("CLIENT_AUTHENTICATED", e.currentTarget));
    }
    onDestroyClient(e) {
        if (e.currentTarget.conn != null)
            this.logger.debug("onDestroyClient " + e.currentTarget.id + ", connId=" + e.currentTarget.conn.id);
        else
            this.logger.debug("onDestroyClient " + e.currentTarget.id + ", connId=null");
    }
    onCloseClient(e) {
        var id = e.currentTarget.id;
        this.authenticatedClients.delete(id);
        this.logger.debug("onCloseClient " + id);
        app.ClusterManager.getClient().hdel("clientsConnexions", e.currentTarget.getConnId());
        this.dispatchEvent(new Tevent("CLIENT_DISCONNECTED", e.currentTarget));
    }
    getClientById(id) {
        var r = null;
        if (this.authenticatedClients.has(id)) {
            r = this.authenticatedClients.get(id);
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
    onRedisPubSubMessage(redisChannel, data) {
        var data = JSON.parse(data);
        if (redisChannel == "pub-sub-messages") {
            this._channelsManager.broadcast(data);
        }
        else if (redisChannel == "direct-messages") {
            if (data.clientsId)
                this.sendMessagesToLocalClients(data.clientsId, data.messages);
            else if (data.userNames)
                this.sendMessagesToLocalUsersNames(data.userNames, data.messages);
            else
                this.logger.error("onRedisPubSubMessage : direct-messages sans 'clientsId' ni 'userNames'");
        }
        else if (redisChannel == "cluster-action") {
            if (data.action == "disconnect-client") {
                this.disconnectLocalClient(data.params.clientId);
            }
        }
        else {
            this.logger.error("onRedisPubSubMessage : redisChannel '" + redisChannel + "' is unknown");
        }
    }
    publish(messages, exclude = null) {
        return this._channelsManager.publish(messages);
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
        if (typeof clientsId == "string") {
            if (clientsId != "*") {
                clientsId = [clientsId];
            }
            else {
                this.eachClient((client) => {
                    client.sendMessages(messages);
                });
                return;
            }
        }
        for (let clientId of clientsId) {
            let client = this.getClientById(clientId);
            if (client) {
                client.sendMessages(messages);
            }
        }
    }
    disconnectLocalClient(id) {
        var r = null;
        if (id != null) {
            var client = this.getClientById(id);
            if (client) {
                client.disconnect();
            }
        }
        return r;
    }
    disconnectClusterClient(id) {
        var data = {
            action: "disconnect-client",
            params: {
                clientId: id
            }
        };
        return app.ClusterManager.getClient().publish("cluster-action", JSON.stringify(data));
    }
    processBeforeRequest(req, res, next) {
        return true;
    }
    initRoutes() {
        this.app.post('/disconnectClient', (req, res, next) => {
            if (!this.processBeforeRequest(req, res, next))
                return;
            var params = req.body;
            this.logger.info("API: disconnect client " + params.clientId);
            this.disconnectClusterClient(params.clientId)
                .then((result) => {
                res.status(200).send({
                    exitCode: 0,
                    message: "Accepted"
                });
            })
                .catch(err => {
                next(err);
            });
        });
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
            this.publish(messages);
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
            if (!this.processBeforeRequest(req, res, next))
                return;
            app.getUserSession(req)
                .then((session) => {
                if (!session) {
                    return next(new Error('no session'));
                }
                else {
                    this.flatify()
                        .then((result) => {
                        res.status(200).send({
                            pubsubserver: result,
                            session: session
                        });
                    });
                }
            })
                .catch(err => {
                return next(err);
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