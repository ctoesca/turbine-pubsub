"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
const Promise = require("bluebird");
const Subscription_1 = require("./Subscription");
var Ttimer = turbine.tools.Ttimer;
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
        this.purgeTimer = new Ttimer({ delay: 600 * 1000 });
        this.purgeTimer.on(Ttimer.ON_TIMER, this.onPurgeTimer, this);
        this.purgeTimer.start();
        this.addChannelInRedis();
    }
    static storeMessage(message) {
        return new Promise(function (resolve, reject) {
            var channelName = message.channel;
            var key = "channels_messages_" + channelName;
            app.ClusterManager.getClient().rpush(key, JSON.stringify(message), function (err, result) {
                if (err) {
                    reject(err);
                    app.logger.debug("storeMessage.rpush: " + err.toString());
                }
                else {
                    app.ClusterManager.getClient().llen(key, function (err, count) {
                        if (err) {
                            app.logger.debug("Channel '" + channelName + "': storeMessage.llen: " + err.toString());
                            reject(err);
                        }
                        else {
                            app.logger.debug("Channel '" + channelName + "': storeMessage.llen = " + count);
                            if (count > this.maxStoredMessages) {
                                app.ClusterManager.getClient().lpop(key, function (err, result) {
                                    if (err) {
                                        app.logger.error("storeMessage.lpop: " + err.toString());
                                        reject(err);
                                    }
                                    else {
                                        app.logger.debug("storeMessage.lpop: success");
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
    onPurgeTimer(e) {
        if (this.subscriptions.length == 0)
            this.free();
    }
    addChannelInRedis() {
        var data = JSON.stringify({
            name: this.name,
            maxStoredMessages: this.maxStoredMessages
        });
        app.ClusterManager.getClient().hset("channels", this.name, data);
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
                        var cid = item.cid;
                        r[cid] = item;
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
            app.ClusterManager.getClient().lrange(key, 0, -1)
                .then((result) => {
                var r = [];
                if (result != null) {
                    for (var i = 0; i < result.length; i++)
                        r.push(JSON.parse(result[i]));
                }
                resolve(r);
            })
                .catch((err) => {
                this.logger.error("channel.getMessages(): " + err.toString());
                reject(err);
            });
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
            this.logger.debug("Création Subscription sur le channel " + this.name + " pour le client " + client.getShortId());
            app.ClusterManager.getClient().hset(this.redisKey, client.id + "_" + this.name, JSON.stringify({
                channelName: this.name,
                cid: client.id,
                connId: client.getConnId(),
                pid: process.pid,
                userName: client.getUserName()
            }));
            if (arguments.length == 2)
                sub.notifySubscribeEvents = notifySubscribeEvents;
            if (sub.notifySubscribeEvents)
                this.sendChannelEvent(client.getSafeDBClient(), "subscribe");
        }
        else {
            this.logger.debug("Subscription sur le channel " + this.name + ": le client " + client.getShortId() + " est déjà abonné");
        }
        return sub;
    }
    createSubscription(client) {
        var sub = new Subscription_1.Subscription(this, client);
        this.subscriptions.push(sub);
        sub.on("DESTROY", this._onSubscriptionDestroy, this);
        this.logger.trace("createSubscription sur channel " + this.name + ", client=" + client.getShortId());
        return sub;
    }
    unsubscribeClient(client) {
        var r = null;
        for (var i = 0; i < this.subscriptions.length; i++) {
            var sub = this.subscriptions[i];
            if (sub.getClient().instanceId === client.instanceId) {
                this.logger.debug("Channel.unsubscribeClient client.id=" + client.getShortId() + ", sub.id=" + sub.id);
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
                if (client.id) {
                    this.sendChannelEvent(client.id, "unsubscribe");
                    this.subscriptions.splice(i, 1);
                    this.logger.debug("Channel.removeSubscription on channel " + this.name + " (cid=" + client.getShortId() + ")");
                }
                else {
                    this.logger.error("_removeSubscriptionById: client.id=" + client.id);
                }
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
                type: type
            }
        };
        if (typeof client == "object")
            message.payload.client = client;
        else
            message.payload.clientId = client;
        this.pubSubServer.publish(message);
    }
    _onSubscriptionDestroy(e) {
        this._removeSubscriptionById(e.currentTarget.id);
    }
    getSubscriptionById(id) {
        var r = null;
        for (var i = 0; i < this.subscriptions.length; i++) {
            if (this.subscriptions[i].id == id) {
                r = this.subscriptions[i];
                break;
            }
        }
        return r;
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
        if (this.subscriptions) {
            for (var i = 0; i < this.subscriptions.length; i++) {
                var sub = this.subscriptions[i];
                sub.free();
            }
            this.subscriptions = null;
        }
        if (this.purgeTimer) {
            this.purgeTimer.free();
            this.purgeTimer = null;
        }
        this.logger = null;
    }
}
exports.Channel = Channel;
//# sourceMappingURL=Channel.js.map