"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
const Promise = require("bluebird");
const Subscription_1 = require("./Subscription");
class Channel extends TeventDispatcher {
    constructor(name, pubSubServer) {
        super();
        this.maxStoredMessages = 100;
        this.subscriptions = [];
        this.name = name;
        this.pubSubServer = pubSubServer;
        this.redisKey = "subscriptions";
        this.logger = app.getLogger("Channel");
        this.logger.debug("Channel created: " + name);
    }
    stop() {
    }
    start() {
    }
    getClients() {
        return new Promise(function (resolve, reject) {
            app.ClusterManager.getClient().hgetall(this.redisKey, function (err, result) {
                var r = {};
                for (var key in result) {
                    var channelName = key.rightOf("_");
                    if (channelName == this.name) {
                        var item = JSON.parse(result[key]);
                        var connId = item.connId;
                        r[connId] = item;
                    }
                }
                resolve(r);
            }.bind(this));
        }.bind(this));
    }
    flatify() {
        return new Promise(function (resolve, reject) {
            var r = {
                name: this.name,
                subscriptions: [],
                clients: {}
            };
            this.getClients().then(function (result) {
                r.clients = result;
                resolve(r);
            });
        }.bind(this));
    }
    getMessages() {
        return new Promise(function (resolve, reject) {
            var key = "channels_messages_" + this.name;
            app.ClusterManager.getClient().lrange(key, 0, -1, function (err, result) {
                if (err) {
                    this.logger.error("channel.getMessages(): " + err.toString());
                    reject(err);
                }
                else {
                    var r = [];
                    if (result != null) {
                        for (var i = 0; i < result.length; i++)
                            r.push(JSON.parse(result[i]));
                    }
                    resolve(r);
                }
            }.bind(this));
        }.bind(this));
    }
    storeMessage(message) {
        return new Promise(function (resolve, reject) {
            var key = "channels_messages_" + this.name;
            app.ClusterManager.getClient().rpush(key, JSON.stringify(message), function (err, result) {
                if (err) {
                    reject(err);
                    this.logger.error("storeMessage.rpush: " + err.toString());
                }
                else {
                    app.ClusterManager.getClient().llen(key, function (err, count) {
                        if (err) {
                            this.logger.error("Channel '" + this.name + "': storeMessage.llen: " + err.toString());
                            reject(err);
                        }
                        else {
                            this.logger.error("Channel '" + this.name + "': storeMessage.llen = " + count);
                            if (count > this.maxStoredMessages) {
                                app.ClusterManager.getClient().lpop(key, function (err, result) {
                                    if (err) {
                                        this.logger.error("storeMessage.lpop: " + err.toString());
                                        reject(err);
                                    }
                                    else {
                                        this.logger.error("storeMessage.lpop: success");
                                        resolve();
                                    }
                                }.bind(this));
                            }
                            else {
                                resolve();
                            }
                        }
                    }.bind(this));
                }
            }.bind(this));
        }.bind(this));
    }
    broadcast(message, filter) {
        var count = 0;
        if (arguments.length > 1) {
            for (var i = 0; i < this.subscriptions.length; i++) {
                if (filter(this.subscriptions[i]))
                    count += this.subscriptions[i].broadcast(message);
            }
        }
        else {
            for (var i = 0; i < this.subscriptions.length; i++)
                count += this.subscriptions[i].broadcast(message);
        }
        if (count > 0)
            this.logger.debug("Messages envoyés sur channel " + this.name + ": " + count);
        return count;
    }
    subscribeClient(client, notifySubscribeEvents) {
        var sub = this.getSubscription(client);
        if (sub == null) {
            sub = this.createSubscription(client);
            this.logger.debug("Création Subscription sur le channel " + this.name + " pour le client " + client.id);
        }
        else {
            sub.setClient(client);
            sub.getQueue().getSize().then(function (result) {
                this.logger.debug("subscribeClient: Réattachement du client au channel " + this.name + ". Messages dans la queue: " + result);
            }.bind(this));
        }
        var connId = client.getConnId();
        if (connId) {
            app.ClusterManager.getClient().hset(this.redisKey, connId + "_" + this.name, JSON.stringify({
                channelName: this.name,
                id: client.id,
                cid: client.id,
                connId: connId,
                pid: process.pid,
                userName: client.getUserName()
            }));
        }
        if (arguments.length == 2)
            sub.notifySubscribeEvents = notifySubscribeEvents;
        if (sub.notifySubscribeEvents)
            this.sendChannelEvent(client, "subscribe");
        return sub;
    }
    createSubscription(client) {
        var sub = new Subscription_1.Subscription(this.name, client);
        this.subscriptions.push(sub);
        sub.on("DESTROY", this._onSubscriptionDestroy, this);
        this.logger.trace("createSubscription sur channel " + this.name + ", client=" + client.id);
        return sub;
    }
    unsubscribeClient(client) {
        var r = null;
        for (var i = 0; i < this.subscriptions.length; i++) {
            var sub = this.subscriptions[i];
            if (sub.getClient().instanceId === client.instanceId) {
                this.logger.info("Channel.unsubscribeClient client.id=" + client.id + ", sub.id=" + sub.id);
                r = sub;
                sub.free();
                break;
            }
        }
        return r;
    }
    _removeSubscriptionById(id) {
        var r = null;
        for (var i = 0; i < this.subscriptions.length; i++) {
            if (this.subscriptions[i].id == id) {
                var client = this.subscriptions[i].client;
                app.ClusterManager.getClient().hdel(this.redisKey, client.getConnId() + "_" + this.name);
                this.sendChannelEvent(client, "unsubscribe");
                this.subscriptions.splice(i, 1);
                this.logger.debug("Channel.removeSubscription on channel " + this.name + ", client.id=" + client.id);
                break;
            }
        }
        return r;
    }
    sendChannelEvent(client, type) {
        var message = {
            type: 'channel_event',
            channel: this.name,
            payload: {
                type: type,
                client: client.DBClient
            }
        };
        this.pubSubServer.broadcast(message);
    }
    _onSubscriptionDestroy(e) {
        this._removeSubscriptionById(e.currentTarget.id);
    }
    getSubscriptions() {
        return this.subscriptions;
    }
    getSubscription(client) {
        var r = null;
        var clientId;
        if (typeof client == "string")
            clientId = client;
        else
            clientId = client.id;
        for (var i = 0; i < this.subscriptions.length; i++) {
            var sub = this.subscriptions[i];
            var c = sub.getClient();
            if ((c != null) && (c.id === clientId)) {
                r = sub;
                break;
            }
        }
        return r;
    }
    sendMessages(messages) {
        for (var i = 0; i < this.subscriptions.length; i++) {
            var subscription = this.subscriptions[i];
            var client = subscription.getClient();
            if (client != null) {
                client.sendMessages(messages);
            }
        }
        ;
    }
    free() {
        this.logger.debug("Channel.free: name=" + this.name);
        super.free();
        for (var i = 0; i < this.subscriptions.length; i++) {
            var sub = this.subscriptions[i];
            app.ClusterManager.getClient().hdel(this.redisKey, sub.client.getConnId() + "_" + this.name);
            sub.free();
            this.subscriptions[i] = null;
        }
        this.subscriptions = null;
        this.logger = null;
    }
}
exports.Channel = Channel;
//# sourceMappingURL=Channel.js.map