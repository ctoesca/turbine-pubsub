"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turbine = require("turbine");
var TeventDispatcher = turbine.events.TeventDispatcher;
const Queue_js_1 = require("./Queue.js");
const Promise = require("bluebird");
class Subscription extends TeventDispatcher {
    constructor(channel, client) {
        super();
        this.notifySubscribeEvents = false;
        this.channelName = null;
        this.noClientTimeout = 120000;
        this.clientDestroyTimestamp = null;
        this.setClient(client);
        this.channel = channel;
        this.channelName = channel.name;
        this.id = this.channelName + "_" + this.client.getConnId();
        this._queue = new Queue_js_1.Queue(this);
        this.logger = app.getLogger("Subscription");
    }
    toJson() {
        var r = {
            clientId: null
        };
        if (this.client)
            r.clientId = this.client.id;
        return JSON.stringify(r);
    }
    fromJson(json) {
        return JSON.parse(json);
    }
    flatify() {
        return new Promise(function (resolve, reject) {
            var r = {
                client: {
                    id: this.client.id,
                    connId: this.client.connId,
                    userName: null
                }
            };
            if (this.client.DBClient)
                r.client.userName = this.client.DBClient.userName;
            resolve(r);
        }.bind(this));
    }
    broadcast(message) {
        if (!this.notifySubscribeEvents && (message.type == "channel_event"))
            return;
        var count = 0;
        if (this.client && this.client.isConnected()) {
            count += this.client.sendMessage(message);
        }
        else {
            if (this.logger)
                this.logger.debug(this.channelName + " envoi message à un client non connecté. Ajout dans le tampon (cid=" + this.client.id + ")");
            this._queue.addMessage(message);
        }
        return count;
    }
    getQueue() {
        return this._queue;
    }
    getClient() {
        return this.client;
    }
    setClient(client) {
        if (this.client != null) {
            this.logger.trace("Subscription.setClient: détachement client " + this.client.instanceId);
            this.client.offByCtx(this);
        }
        this.client = client;
        this.clientDestroyTimestamp = null;
        this.client.on("DESTROY", this._onClientDestroy, this);
        this.client.on("CLOSE", this._onClientClose, this);
    }
    _onClientClose(e) {
        this.channel.sendChannelEvent(e.currentTarget.getSafeDBClient(), "disconnected");
        var redisKey = e.data.connId + "_" + this.channelName;
        app.ClusterManager.getClient().hget("subscriptions", redisKey)
            .then(result => {
            var subscription = JSON.parse(result);
            if (subscription == null) {
                throw "subscription " + redisKey + " = NULL";
            }
            else {
                subscription.connId = null;
                return app.ClusterManager.getClient().hset("subscriptions", redisKey, JSON.stringify(subscription));
            }
        })
            .then(result => {
            this.logger.debug("subscriptions " + redisKey + " => set connId = NULL");
        })
            .catch(err => {
            this.logger.error("subscription._onClientClose: ", err);
        });
    }
    _onClientDestroy(e) {
        this.logger.info("subscription._onClientDestroy: DESTROY subscription " + this.channelName + " (cid=" + this.client.id + ")");
        this.free();
    }
    free() {
        if (this.client)
            this.logger.debug("Subscription.free: channelName=" + this.channelName + ", client=" + this.client.id);
        else
            this.logger.debug("Subscription.free: channelName=" + this.channelName + ", client=null");
        super.free();
        if (this.client)
            this.client.offByCtx(this);
        this.client = null;
        this.logger = null;
        if (this._queue)
            this._queue.free();
        this._queue = null;
    }
}
exports.Subscription = Subscription;
//# sourceMappingURL=Subscription.js.map