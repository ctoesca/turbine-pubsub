"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
var Tevent = turbine.events.Tevent;
var tools = turbine.tools;
const Promise = require("bluebird");
const UAParser = require("ua-parser-js");
class Client extends TeventDispatcher {
    constructor(server, conn, opt) {
        super();
        this.id = null;
        this.ip = null;
        this.DBClient = null;
        this.useSockjs = false;
        this.conn = null;
        this.session = null;
        this.authenticated = false;
        this.userAgent = null;
        this.closeDate = null;
        this.creationDate = null;
        this._rpcMethods = {
            "getConnectedClients": true,
            "authenticate": true,
            "subscribe": true,
            "getChannelClients": true,
            "getChannelMessages": true,
            "unsubscribe": true
        };
        if (typeof opt.useSockjs != "undefined")
            this.useSockjs = opt.useSockjs;
        if (typeof opt.session != "undefined") {
            this.session = opt.session;
        }
        this.creationDate = new Date().getTime();
        this.lastActivityDate = this.creationDate;
        if (typeof Client.lastIntanceId == "undefined")
            Client.lastIntanceId = 0;
        Client.lastIntanceId++;
        this.instanceId = Client.lastIntanceId;
        this.logger = app.getLogger(this.constructor.name);
        this.conn = conn;
        this.server = server;
        if (this.useSockjs)
            this.conn.on('data', this.onMessage.bind(this));
        else
            this.conn.on('message', this.onMessage.bind(this));
        this.conn.on('close', this.onClose.bind(this));
        this.conn.on('error', (e) => {
            this.logger.debug("error " + e);
        });
        this.logger.info("Client créé. username: " + this.getUserName());
        if (typeof opt.req == "object") {
            this.ip = tools.getIpClient(opt.req);
            if (opt.req.headers)
                this.userAgent = new UAParser(opt.req.headers["user-agent"]).getResult();
        }
    }
    toDTO() {
        let r = {
            id: this.id,
            connId: this.getConnId(),
            lastActivityDate: this.lastActivityDate,
            authenticated: this.authenticated,
            closeDate: this.closeDate,
            creationDate: this.creationDate
        };
        return r;
    }
    getSessionId() {
        var r = null;
        if ((this.session != null) && (this.session.sid))
            r = this.session.sid;
        return r;
    }
    getUserName() {
        var r = null;
        if ((this.session != null) && (this.session.user_name))
            r = this.session.user_name;
        return r;
    }
    getUserId() {
        var r = null;
        if ((this.session != null) && (this.session.user_id))
            r = this.session.user_id;
        return r;
    }
    flatify() {
        return new Promise(function (resolve, reject) {
            var r = {
                client: this.DBClient,
                connId: null,
                lastActivityDate: this.lastActivityDate
            };
            if (this.conn != null)
                r.connId = this.conn.id;
            resolve(r);
        }.bind(this));
    }
    getShortId() {
        var r = null;
        if (this.id != null) {
            r = this.id.substring(0, 10) + "...";
        }
        return r;
    }
    getConnId() {
        var r = null;
        if (this.conn && this.conn.id)
            r = this.conn.id;
        return r;
    }
    sendMessage(message) {
        return this.sendMessages([message]);
    }
    sendMessages(messages) {
        var userName = this.getUserName();
        var count = 0;
        if (this.isConnected()) {
            var messagesToSend = [];
            for (var i = 0; i < messages.length; i++) {
                var message = messages[i];
                if (typeof message.creation_time == "undefined")
                    message.creation_time = new Date();
                messagesToSend.push(message);
            }
            count = messagesToSend.length;
            if (messagesToSend.length > 0) {
                var json = JSON.stringify(messagesToSend);
                this.logger.debug("Envoi " + messagesToSend.length + " message(s) à " + this.getShortId() + " (user=" + userName + ")");
                this.sendMessageToWebsocket(json);
            }
        }
        else {
            if (this.logger) {
                this.logger.warn("sendMessages: client is not connected: id=" + this.getShortId() + " (user=" + userName + ")");
            }
        }
        return count;
    }
    isConnected() {
        var r = (this.conn != null);
        if (r) {
            if (!this.useSockjs)
                r = (this.conn.readyState == this.conn.OPEN);
        }
        return r;
    }
    sendMessageToWebsocket(msg) {
        this.touchClusterClient();
        if (this.useSockjs) {
            this.conn.write(msg);
        }
        else {
            this.conn.send(msg, function ack(error) {
                if (error) {
                    this.logger.error(error.toString());
                }
            }.bind(this));
        }
    }
    disconnect() {
        if (this.conn == null)
            return;
        if (this.useSockjs)
            this.conn.end();
        else
            this.conn.close();
    }
    onMessage(message, flags) {
        if (this.isDestroyed) {
            console.log("onMessage: CLIENT IS DESTROYED !!");
            return;
        }
        this.touchClusterClient();
        message = JSON.parse(message);
        let evt = new Tevent("MESSAGE", {
            message: message
        });
        this.dispatchEvent(evt);
        if (evt.defaultPrevented)
            return;
        if (message.type == 'publish') {
            this.logger.debug("User " + this.getUserName() + ": publish message: type=", message.type + ", channel=" + message.channel);
            if (this.id != null) {
                this.server.publish(message);
            }
            else {
                this.logger.warn("publish: clientId is NULL");
            }
        }
        else if (message.type == 'rpc') {
            var functionName = message.payload.functionName;
            this.logger.trace("Appel RPC: " + functionName);
            try {
                if ((functionName != "authenticate") && !this.authenticated)
                    throw "Error invoking '" + functionName + "': Not authenticated";
                if (typeof this._rpcMethods[functionName] == "undefined")
                    throw "RPC method '" + functionName + "' does not exists";
                if (typeof this[functionName] == "undefined")
                    throw "Method '" + functionName + "'' does not exists";
                if ((this.DBClient == null) && (functionName != "authenticate"))
                    throw "Error calling RPC method " + functionName + ": not authenticated";
                this[functionName](message.payload.args, function (r) {
                    this.returnRpcResult(message.payload, r);
                }.bind(this), function (error) {
                    this.returnRpcFailure(message.payload, error);
                }.bind(this));
            }
            catch (error) {
                this.returnRpcFailure(message.payload, error.toString());
            }
        }
        else if (message.type == 'user_message') {
            if (this.id != null) {
                this.server.sendToUsers(message.userNames, message);
            }
            else {
                this.logger.debug("clientId is NULL");
            }
        }
    }
    getSafeDBClient() {
        if (this.DBClient == null) {
            return null;
        }
        else {
            var r = {};
            for (let k in this.DBClient)
                if (k != "sessionId")
                    r[k] = this.DBClient[k];
            return r;
        }
    }
    onClose(data) {
        if (this.isDestroyed) {
            this.logger.warn("Client.onClose: CLIENT IS ALREADY DESTROYED !!");
            return;
        }
        if (this.logger)
            this.logger.info("close connection username=" + this.getUserName() + ", cid=" + this.getShortId());
        if (this.server && this.DBClient)
            this.server.publish({ type: 'publish', channel: "system", payload: { type: "disconnected", client: this.getSafeDBClient() } });
        this.dispatchEvent(new Tevent("CLOSE", this.DBClient));
        this.conn = null;
        this.free();
    }
    free() {
        if (this.isDestroyed) {
            this.logger.warn("Client.free: CLIENT IS ALREADY DESTROYED !!");
            return;
        }
        super.free();
        this.disconnect();
        app.ClusterManager.getClient().hdel("clients", this.id)
            .then((result) => {
            this.logger.info("Destroy client " + this.getShortId() + ": suppression dans REDIS");
        })
            .catch((err) => {
            this.logger.error("Tclient.free id=" + this.getShortId() + " : " + err.toString());
        })
            .finally(() => {
            this.conn = null;
            this.server = null;
            this.DBClient = null;
            this.authenticated = false;
            this.logger = null;
            this.id = null;
        });
    }
    returnRpcResult(payload, result) {
        if (this.isDestroyed)
            return;
        this.sendMessage({
            type: 'rpc_callback',
            payload: {
                correlationId: payload.correlationId,
                exception: null,
                functionName: payload.functionName,
                result: result
            }
        });
    }
    returnRpcFailure(payload, exception) {
        if (this.isDestroyed)
            return;
        this.logger.warn("Echec appel RPC: " + payload.functionName + " => ", exception);
        if (typeof exception == "string")
            exception = { message: exception };
        else if (exception instanceof Error)
            exception = { message: exception.toString() };
        else
            exception = { message: JSON.stringify(exception) };
        this.sendMessage({
            type: 'rpc_callback',
            payload: {
                correlationId: payload.correlationId,
                exception: exception,
                functionName: payload.functionName
            }
        });
    }
    touchClusterClient() {
        if (this.conn != null) {
            this.lastActivityDate = new Date().getTime();
            this.flatify().then(function (result) {
                app.ClusterManager.getClient().hset("clientsConnexions", this.conn.id, JSON.stringify(result));
            }.bind(this));
        }
    }
    getConnectedClients(args, success, failure) {
        this.logger.debug("getConnectedClients", args);
        return this.server.getClusterConnexions()
            .then((result) => {
            var clientsHash = {};
            var r = [];
            for (var connId in result) {
                var conn = result[connId];
                if (conn.client) {
                    clientsHash[conn.client.id] = conn.client;
                    conn.client.sessionId = undefined;
                    r.push(conn.client);
                }
            }
            success(r);
            return r;
        })
            .catch((err) => {
            this.logger.error("getConnectedClients", err);
            failure(err);
        });
    }
    getChannelMessages(args, success, failure) {
        var channelsManager = this.server.getChannelsManager();
        var channel = channelsManager.getChannel(args.channel, true);
        if (channel != null) {
            channel.getMessages().then(function (result) {
                success(result);
            }, function (err) {
                failure(err);
            });
        }
        else {
            failure("Channel '" + args.channel + "' does not exists on this node");
        }
    }
    getChannelClients(args, success, failure) {
        this.server.getChannelsManager().getChannelClients(args.channel)
            .then((result) => {
            if (success)
                success(result);
        })
            .catch((err) => {
            this.logger.warn("getChannelClients: " + err.toString());
            if (failure)
                failure(err);
        });
    }
    unsubscribe(args, success, failure) {
        var userName = this.getUserName();
        var subs = [];
        this.logger.info("user " + userName + " => UNSUBSCRIBE =>> " + args.channels.length + " channel(s)");
        var channelsManager = this.server.getChannelsManager();
        for (var i = 0; i < args.channels.length; i++) {
            var channel = channelsManager.getChannel(args.channels[i]);
            if (channel != null) {
                var sub = channel.unsubscribeClient(this);
                if (sub)
                    subs.push({ channel: channel.name, id: sub.id, notifySubscribeEvents: sub.notifySubscribeEvents });
            }
        }
        success(subs);
    }
    subscribe(args, success, failure) {
        if (this.DBClient == null) {
            failure("subscribe: le client n'est pas identifié");
        }
        else {
            this.logger.debug("subscribe args=", args);
            var userName = this.getUserName();
            var subs = [];
            var channelsManager = this.server.getChannelsManager();
            var channelsNames = "";
            var promises = [];
            for (var i = 0; i < args.channels.length; i++) {
                promises.push(this.server.canSubscribe(this, args.channels[i].name));
            }
            Promise.all(promises)
                .then(function (result) {
                var cancelled = 0;
                var accepted = 0;
                for (var i = 0; i < args.channels.length; i++) {
                    let canSubscribe = result[i];
                    if (canSubscribe) {
                        var channel = channelsManager.getChannel(args.channels[i].name, true);
                        channelsNames += args.channels[i].name + " ";
                        try {
                            var sub = channel.subscribeClient(this, {
                                notifySubscribeEvents: args.channels[i].notifySubscribeEvents
                            });
                            sub = { channel: channel.name, id: sub.id, notifySubscribeEvents: sub.notifySubscribeEvents, pendingMessages: sub.getQueue().consume() };
                            subs.push(sub);
                            accepted++;
                            this.logger.debug("user " + userName + " => SUBSCRIBE channel '" + channel.name + "'. notifySubscribeEvents=" + args.channels[i].notifySubscribeEvents);
                        }
                        catch (err) {
                            this.logger.warn(err);
                            cancelled++;
                        }
                    }
                    else {
                        cancelled++;
                    }
                }
                success(subs);
                this.logger.info("user " + userName + " => SUBSCRIBE =>> " + subs.length + " channel(s) - rejected: " + cancelled + ", accepted: " + accepted);
            }.bind(this))
                .catch(err => {
                failure(err);
            });
        }
    }
    saveClient() {
        if (!this.id)
            return;
        var newClient = {
            "id": this.id,
            "connId": this.getConnId(),
            "userAgent": this.userAgent,
            "id_user": this.getUserId(),
            "userName": this.getUserName(),
            "ip": this.ip,
            "sessionId": this.getSessionId(),
            "connected": this.isConnected(),
            "closeDate": this.closeDate,
            "creationDate": this.creationDate
        };
        this.DBClient = newClient;
        return app.ClusterManager.getClient().hset("clients", this.id, JSON.stringify(newClient))
            .then(function (result) {
            return newClient;
        });
    }
    authenticate(args, success, failure) {
        if (typeof args.clientId == "undefined") {
            failure("authenticate: args.clientId est undefined");
            return;
        }
        if (this.authenticated) {
            failure("Already authenticated");
        }
        else {
            var oldClient = null;
            app.ClusterManager.getClient().hget("clients", args.clientId)
                .then((oldClient) => {
                if (oldClient !== null) {
                    var oldClient = JSON.parse(oldClient);
                    this.logger.debug("AUTH: oldClient=", oldClient);
                }
                this.id = args.clientId;
                this.authenticated = true;
                return this.saveClient();
            })
                .then((newClient) => {
                this.DBClient = newClient;
                this.logger.info("authenticate: client " + this.getShortId() + ". userName=" + this.getUserName() + " (ID=" + this.getUserId() + ")");
                var clientClone = this.getSafeDBClient();
                success(clientClone);
                this.dispatchEvent(new Tevent("AUTHENTICATED"));
                this.server.publish({ type: 'publish', channel: "system", payload: { type: "connected", client: clientClone } });
            })
                .catch((err) => {
                this.authenticated = false;
                this.DBClient = null;
                this.id = null;
                this.logger.error(err);
                failure(err);
            });
        }
    }
}
Client.lastIntanceId = null;
exports.Client = Client;
//# sourceMappingURL=Client.js.map