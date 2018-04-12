"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
var Tevent = turbine.events.Tevent;
const Promise = require("bluebird");
class Client extends TeventDispatcher {
    constructor(server, conn, opt) {
        super();
        this.id = null;
        this.ip = null;
        this.DBClient = null;
        this.useSockjs = false;
        this.conn = null;
        if (typeof opt.useSockjs != "undefined")
            this.useSockjs = opt.useSockjs;
        this.lastActivityDate = new Date().getTime();
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
        this.logger.debug("Client créé " + conn.id + ". PROTOCOL: " + this.conn.protocol);
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
    getUserName() {
        var r = null;
        if (this.DBClient != null)
            r = this.DBClient.userName;
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
        if (this.useSockjs)
            return r;
        else
            return (r && (this.conn.readyState == this.conn.OPEN));
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
        if (message.type == 'publish') {
            this.logger.debug("User " + this.getUserName() + ": publish message: type=", message.type + ", channel=" + message.channel);
            if (this.id != null) {
                this.server.broadcast(message);
            }
            else {
                this.logger.debug("clientId is NULL");
            }
        }
        else if (message.type == 'rpc') {
            this.logger.trace("Appel RPC: " + message.payload.functionName);
            if (typeof this[message.payload.functionName] == "undefined") {
                this.returnRpcFailure(message.payload, "Method '" + message.payload.functionName + "'' does not exists");
                return;
            }
            try {
                this[message.payload.functionName](message.payload.args, function (r) {
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
    onClose(data) {
        if (this.isDestroyed) {
            this.logger.warn("onClose: CLIENT IS ALREADY DESTROYED !!");
            return;
        }
        if (this.logger)
            this.logger.debug("close " + this.id);
        if (this.server && this.DBClient)
            this.server.broadcast({ type: 'publish', channel: "system", payload: { type: "disconnected", client: this.DBClient } });
        var connId = this.conn.id;
        this.conn = null;
        this.dispatchEvent(new Tevent("CLOSE", { connId: connId }));
    }
    free() {
        this.logger.debug("Tclient.free clientId=" + this.getShortId());
        super.free();
        this.conn = null;
        this.server = null;
        this.logger = null;
        this.DBClient = null;
    }
    returnRpcResult(payload, result) {
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
    returnRpcFailure(payload, errorMessage) {
        this.logger.warn("Echec appel RPC: " + payload.functionName + " => ", errorMessage);
        if (typeof errorMessage == "object")
            errorMessage = { message: errorMessage.toString() };
        this.sendMessage({
            type: 'rpc_callback',
            payload: {
                correlationId: payload.correlationId,
                exception: errorMessage,
                functionName: payload.functionName
            }
        });
    }
    getConnectedClients(args, success, failure) {
        this.logger.info("getConnectedClients", args);
        return this.server.getClusterConnexions()
            .then(function (result) {
            this.logger.error(result);
            var clientsHash = {};
            var r = [];
            for (var connId in result) {
                var conn = result[connId];
                if (conn.client) {
                    clientsHash[conn.client.cid] = conn.client;
                    r.push(conn.client);
                }
            }
            success(r);
            return r;
        }.bind(this))
            .catch(function (err) {
            this.logger.error("getConnectedClients", err);
            failure(err);
        }.bind(this));
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
            .then(function (result) {
            if (success)
                success(result);
        }.bind(this), function (err) {
            this.logger.warn("getChannelClients: " + err.toString());
            if (failure)
                failure(err);
        }.bind(this));
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
        this.logger.debug("subscribe args=", args);
        if (this.DBClient == null) {
            failure("subscribe: le client n'est pas identifié");
        }
        else {
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
                let cancelled = 0;
                for (var i = 0; i < args.channels.length; i++) {
                    let canSubscribe = result[i];
                    if (canSubscribe) {
                        var channel = channelsManager.getChannel(args.channels[i].name, true);
                        channelsNames += args.channels[i].name + " ";
                        var sub = channel.subscribeClient(this, args.channels[i].notifySubscribeEvents);
                        sub = { channel: channel.name, id: sub.id, notifySubscribeEvents: sub.notifySubscribeEvents, pendingMessages: sub.getQueue().consume() };
                        subs.push(sub);
                        this.logger.debug("user " + userName + " => SUBSCRIBE channel '" + channel.name + "'. notifySubscribeEvents=" + args.channels[i].notifySubscribeEvents);
                    }
                    else {
                        cancelled++;
                    }
                }
                success(subs);
                this.logger.info("user " + userName + " => SUBSCRIBE =>> " + subs.length + " channel(s) - cancelled subscriptions: " + cancelled);
            }.bind(this));
        }
    }
    touchClusterClient() {
        this.lastActivityDate = new Date().getTime();
        this.flatify().then(function (result) {
            app.ClusterManager.getClient().hset("clientsConnexions", this.conn.id, JSON.stringify(result));
        }.bind(this));
    }
    authenticate(args, success, failure) {
        this.id = args.clientId;
        this.logger.debug("authenticate on worker " + process.pid);
        app.ClusterManager.getClient().hget("clients", args.clientId, function (err, result) {
            if (err) {
                this.logger.error(err);
                failure(err);
            }
            else {
                var client = JSON.parse(result);
                if (client != null) {
                    this.DBClient = client;
                    this.logger.info("authenticate: Client IP=" + this.ip + ", clientId=" + client.cid + ", userName=" + client.userName);
                    success(client);
                    this.server.broadcast({ type: 'publish', channel: "system", payload: { type: "connected", client: client } });
                }
                else {
                    this.DBClient = null;
                    failure("Le client '" + this.id + "' n'existe pas dans REDIS");
                }
                if (this.conn != null) {
                    this.flatify().then(function (result) {
                        app.ClusterManager.getClient().hset("clientsConnexions", this.conn.id, JSON.stringify(result));
                    }.bind(this));
                }
            }
        }.bind(this));
    }
}
Client.lastIntanceId = null;
exports.Client = Client;
//# sourceMappingURL=Client.js.map