"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
class PurgeService {
    constructor(pubsubServer, config = null) {
        this.pubsubServer = null;
        this.logger = null;
        this.config = null;
        this.pubsubServer = pubsubServer;
        if (config == null)
            this.config = this.getDefaultConfig();
        else
            this.config = config;
        this.logger = app.getLogger("PurgeService");
        this.logger.info("PurgeService created.");
    }
    getDefaultConfig() {
        return {
            "redisConnexionsTimeout": 600,
            "redisClientsTimeout": 600,
            "destroyClientsTimeout": 120
        };
    }
    purgeRedisConnections() {
        return Promise.resolve();
    }
    purgeRedisSubscriptions() {
        var activeConnexions = {};
        var inactiveConnexions = {};
        var activeMessagesQueues = {};
        return this.pubsubServer.getClusterConnexions()
            .then((result) => {
            var now = new Date().getTime() / 1000;
            var connToDelete = [];
            for (var connId in result) {
                var connexion = result[connId];
                var diffSec = null;
                if (typeof connexion.lastActivityDate == "number")
                    diffSec = now - (connexion.lastActivityDate / 1000);
                if ((diffSec === null) || (diffSec > this.config.redisConnexionsTimeout)) {
                    inactiveConnexions[connId] = connexion;
                    connToDelete.push(connId);
                }
                else {
                    activeConnexions[connId] = connexion;
                }
            }
            if (connToDelete.length) {
                app.ClusterManager.getClient().hdel("clientsConnexions", connToDelete)
                    .then((result) => {
                    this.logger.info("Suppression " + connToDelete.length + " connexions dans REDIS");
                })
                    .catch((err) => {
                    this.logger.error("Suppression " + connToDelete.length + " connexions dans REDIS: " + err.toString());
                });
            }
            return activeConnexions;
        })
            .then((activeConnexions) => {
            this.logger.debug("activeConnexions ", activeConnexions);
            return app.ClusterManager.getClient().hgetall("subscriptions");
        })
            .then((subscriptions) => {
            var r = {};
            var subscriptionsToDelete = [];
            var messagesQueuesToDelete = [];
            for (var key in subscriptions) {
                var sub = JSON.parse(subscriptions[key]);
                var channelName = sub.channelName;
                var messagesQueuesId = channelName + "_" + sub.cid + "_messages_queue";
                var connId = key.leftOf("_");
                if (!connId)
                    this.logger.warn("connId non défini: key=" + key);
                if (!activeConnexions[connId]) {
                    subscriptionsToDelete.push(key);
                    messagesQueuesToDelete.push(messagesQueuesId);
                    if (inactiveConnexions[connId]) {
                        var client = inactiveConnexions[connId].client;
                        this.pubsubServer.sendChannelEvent("unsubscribe", channelName, client.id);
                    }
                }
                else {
                    activeMessagesQueues[messagesQueuesId] = true;
                }
            }
            var promises = [];
            if (subscriptionsToDelete.length > 0) {
                this.logger.info("Suppression de " + subscriptionsToDelete.length + " subscription(s) dans REDIS");
                promises.push(app.ClusterManager.getClient().hdel("subscriptions", subscriptionsToDelete));
            }
            if (messagesQueuesToDelete.length > 0) {
                this.logger.info("Suppression de " + messagesQueuesToDelete.length + " message_queues dans REDIS");
                promises.push(app.ClusterManager.getClient().del(messagesQueuesToDelete));
            }
            return Promise.all(promises);
        })
            .then((deleteResult) => {
            return app.ClusterManager.getClient().keys(app.ClusterManager.keyPrefix + "*_messages_queue");
        })
            .then((results) => {
            var messagesQueuesToDelete = [];
            for (var i = 0; i < results.length; i++) {
                var key = results[i];
                var messagesQueuesId = key.rightOf(app.ClusterManager.keyPrefix);
                if (typeof activeMessagesQueues[messagesQueuesId] == "undefined") {
                    messagesQueuesToDelete.push(messagesQueuesId);
                }
            }
            if (messagesQueuesToDelete.length > 0) {
                this.logger.info("Suppression de " + messagesQueuesToDelete.length + " message_queues dans REDIS");
                return app.ClusterManager.getClient().del(messagesQueuesId);
            }
            else {
                return Promise.resolve();
            }
        });
    }
    purgeRedisClients() {
        this.logger.debug("purgeRedisClients");
        var now = Math.round(new Date().getTime() / 1000);
        var from = now - this.config.redisClientsTimeout;
        return app.ClusterManager.getClient().hgetall("clients")
            .then(result => {
            let clientsId = [];
            for (var k in result) {
                var client = JSON.parse(result[k]);
                if (typeof client.last_use == "undefined") {
                    this.logger.warn("purgeRedisClients: client.last_use non défini");
                }
                else if (client.last_use < from) {
                    this.logger.info("Supression client " + k + " dans REDIS");
                    clientsId.push(client.id);
                }
            }
            if (clientsId.length > 0)
                return app.ClusterManager.getClient().hdel("clients", clientsId);
            else
                return Promise.resolve();
        })
            .catch(err => {
            this.logger.error("purgeRedisClients", err);
        });
    }
    destroyOldClients() {
        var now = new Date().getTime() / 1000;
        var connectedClients = 0;
        var toDelete = [];
        for (var i in this.pubsubServer.clients) {
            var c = this.pubsubServer.clients[i];
            if (c == null) {
                this.logger.warn(i + " => NULL client");
                toDelete.push(i);
            }
            else {
                if ((c.conn == null) && c.closeDate) {
                    this.logger.debug(i + " => client.conn = NULL, clientId=" + c.getShortId());
                    var diffSec = now - (c.closeDate / 1000);
                    if (diffSec > this.config.destroyClientsTimeout) {
                        c.free();
                        toDelete.push(i);
                    }
                }
                else {
                    c.touchClusterClient();
                    if (c.id) {
                        this.logger.debug(i + " => client authenticated, clientId=" + c.getShortId());
                        connectedClients++;
                    }
                    else {
                        this.logger.debug(i + " => client not authenticated");
                    }
                }
            }
        }
        for (var j = 0; j < toDelete.length; j++) {
            delete this.pubsubServer.clients[toDelete[j]];
        }
        this.logger.info("Worker " + process.pid + ": Clients connected:" + connectedClients + ", supprimés:" + toDelete.length);
        return Promise.resolve();
    }
}
exports.PurgeService = PurgeService;
//# sourceMappingURL=PurgeService.js.map