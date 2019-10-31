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
        this.subscriptions = new Map();
        this.accessKey = null;
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
        return new Promise((resolve, reject) => {
            var channelName = message.channel;
            var key = "channels_messages_" + channelName;
            app.ClusterManager.getClient().rpush(key, JSON.stringify(message), (err, result) => {
                if (err) {
                    reject(err);
                    app.logger.debug("storeMessage.rpush: " + err.toString());
                }
                else {
                    app.ClusterManager.getClient().llen(key, (err, count) => {
                        if (err) {
                            app.logger.debug("Channel '" + channelName + "': storeMessage.llen: " + err.toString());
                            reject(err);
                        }
                        else {
                            app.logger.debug("Channel '" + channelName + "': storeMessage.llen = " + count);
                            app.ClusterManager.getClient().lpop(key, (err, result) => {
                                if (err) {
                                    app.logger.error("storeMessage.lpop: " + err.toString());
                                    reject(err);
                                }
                                else {
                                    app.logger.debug("storeMessage.lpop: success");
                                    resolve();
                                }
                            });
                        }
                    });
                }
            });
        });
    }
    onPurgeTimer(e) {
        if (this.subscriptions.size == 0)
            this.free();
    }
    addChannelInRedis() {
        var data = JSON.stringify({
            name: this.name,
            maxStoredMessages: this.maxStoredMessages,
            accessKey: this.accessKey
        });
        app.ClusterManager.getClient().hset("channels", this.name, data);
    }
    stop() {
    }
    start() {
    }
    getClients() {
        return new Promise((resolve, reject) => {
            app.ClusterManager.getClient().hgetall(this.redisKey, (err, result) => {
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
            });
        });
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
        return new Promise((resolve, reject) => {
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
        });
    }
    broadcast(message, filter) {
        var count = 0;
        if (arguments.length > 1) {
            this.subscriptions.forEach((sub, key) => {
                if (filter(sub))
                    count += sub.broadcast(message);
            });
        }
        else {
            this.subscriptions.forEach((sub, key) => {
                count += sub.broadcast(message);
            });
        }
        if (count > 0)
            this.logger.debug("Messages envoyés sur channel " + this.name + ": " + count);
        return count;
    }
    subscribeClient(client, opt = {}) {
        if (this.accessKey) {
            if (opt.accessKey !== this.accessKey) {
                throw "Forbidden acces to channel " + this.name + " (accessKey needed)";
            }
        }
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
            if (typeof opt.notifySubscribeEvents !== 'undefined')
                sub.notifySubscribeEvents = opt.notifySubscribeEvents;
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
        this.subscriptions.set(sub.id, sub);
        sub.on("DESTROY", this._onSubscriptionDestroy, this);
        this.logger.trace("createSubscription sur channel " + this.name + ", client=" + client.getShortId());
        return sub;
    }
    unsubscribeClient(client) {
        var r = null;
        let sub = this.getSubscription(client);
        if (sub) {
            this.logger.debug("Channel.unsubscribeClient client.id=" + client.getShortId() + ", sub.id=" + sub.id);
            r = sub;
            sub.free();
        }
        return r;
    }
    _removeSubscriptionById(id) {
        var sub = null;
        if (this.subscriptions.has(id)) {
            sub = this.subscriptions.get(id);
            var client = sub.client;
            if (client.id) {
                this.sendChannelEvent(client.id, "unsubscribe");
                this.logger.debug("Channel.removeSubscription on channel " + this.name + " (cid=" + client.getShortId() + ")");
            }
            else {
                this.logger.error("_removeSubscriptionById: client.id=" + client.getShortId());
            }
            this.subscriptions.delete(id);
        }
        return sub;
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
        if (this.subscriptions.has(id)) {
            r = this.subscriptions.get(id);
        }
        return r;
    }
    getSubscriptions() {
        return this.subscriptions;
    }
    getSubscription(client) {
        var r = null;
        let subId = Subscription_1.Subscription.calcId(this.name, client);
        if (this.subscriptions.has(subId)) {
            r = this.subscriptions.get(subId);
        }
        return r;
    }
    sendMessages(messages) {
        this.subscriptions.forEach((sub, key) => {
            var client = sub.getClient();
            if (client != null) {
                client.sendMessages(messages);
            }
        });
    }
    free() {
        this.logger.debug("Channel.free: name=" + this.name);
        super.free();
        if (this.subscriptions) {
            this.subscriptions.forEach((sub, key) => {
                sub.free();
            });
            this.subscriptions.clear();
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