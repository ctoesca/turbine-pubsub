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
            "redisConnexionsTimeout": 300,
            "redisClientsTimeout": 300,
            "notAuthenticatedClientsTimeout": 120
        };
    }
    raz() {
    }
    purgeRedisConnections() {
        var now = new Date().getTime() / 1000;
        var connections;
        var clients;
        var connToDelete = {};
        return this.pubsubServer.getClusterConnexions()
            .then((result) => {
            connections = result;
            for (var connId in connections) {
                var connexion = connections[connId];
                var diffSec = now - (new Date(connexion.lastActivityDate).getTime() / 1000);
                if (diffSec > this.config.redisConnexionsTimeout) {
                    connToDelete[connId] = connexion;
                }
            }
            let connToDeleteArray = Object.keys(connToDelete);
            if (connToDeleteArray.length) {
                app.ClusterManager.getClient().hdel("clientsConnexions", connToDeleteArray)
                    .then((result) => {
                    this.logger.info(connToDeleteArray.length + " connexions supprimées dans REDIS");
                })
                    .catch((err) => {
                    this.logger.error("Echec suppression " + connToDeleteArray.length + " connexions dans REDIS: " + err.toString());
                });
            }
            return this.pubsubServer.getClusterClients();
        })
            .then((result) => {
            clients = result;
            var clientsToDelete = [];
            for (var cid in clients) {
                var client = clients[cid];
                if ((typeof connections[client.connId] === "undefined") || (typeof connToDelete[client.connId] !== "undefined")) {
                    clientsToDelete.push(cid);
                }
            }
            if (clientsToDelete.length > 0) {
                app.ClusterManager.getClient().hdel("clients", clientsToDelete)
                    .then((result) => {
                    this.logger.info(clientsToDelete.length + " clients supprimées dans REDIS");
                })
                    .catch((err) => {
                    this.logger.error("Echec suppression " + clientsToDelete.length + " clients dans REDIS: " + err.toString());
                });
            }
        });
    }
    purgeRedisSubscriptions() {
        var clients;
        return app.ClusterManager.getClient().hgetall("clients")
            .then((result) => {
            clients = result;
            return app.ClusterManager.getClient().hgetall("subscriptions");
        })
            .then((subscriptions) => {
            var r = {};
            var subscriptionsToDelete = [];
            var messagesQueuesToDelete = [];
            for (var key in subscriptions) {
                var sub = JSON.parse(subscriptions[key]);
                if (!sub.cid) {
                    this.logger.warn("sub.cid non défini: key=" + key);
                }
                var channelName = sub.channelName;
                var messagesQueuesId = channelName + "_" + sub.cid + "_messages_queue";
                var clientExists = (typeof clients[sub.cid] !== "undefined");
                if (!clientExists) {
                    subscriptionsToDelete.push(key);
                    messagesQueuesToDelete.push(messagesQueuesId);
                }
            }
            var promises = [];
            if (subscriptionsToDelete.length > 0) {
                this.logger.info("Suppression de " + subscriptionsToDelete.length + " subscription(s) dans REDIS");
                promises.push(app.ClusterManager.getClient().hdel("subscriptions", subscriptionsToDelete));
                promises.push(app.ClusterManager.getClient().del(messagesQueuesToDelete));
            }
            return Promise.all(promises);
        })
            .then((deleteResult) => {
            return app.ClusterManager.getClient().keys(app.ClusterManager.keyPrefix + "*_messages_queue");
        })
            .then((results) => {
        });
    }
    destroyOldClients() {
        var now = new Date().getTime() / 1000;
        var connectedClients = 0;
        var toDelete = [];
        this.pubsubServer.eachClient((client) => {
            if (!client.isConnected()) {
                this.logger.info("Client (id=" + client.getShortId() + ") => not connected => destroy");
                toDelete.push(client);
            }
            else {
                if (client.authenticated) {
                    this.logger.debug("Client (id=" + client.getShortId() + ") => authenticated");
                    connectedClients++;
                }
                else {
                    var diffSec = now - (new Date(client.creationDate).getTime() / 1000);
                    if (diffSec > this.config.notAuthenticatedClientsTimeout) {
                        this.logger.info("Client (id=" + client.getShortId() + ") => not authenticated => destroy");
                        toDelete.push(client);
                    }
                }
            }
        });
        for (var j = 0; j < toDelete.length; j++) {
            this.pubsubServer.removeClient(toDelete[j]);
        }
        this.logger.info("Worker " + process.pid + ": Clients connected:" + connectedClients + ", supprimés:" + toDelete.length);
        return Promise.resolve();
    }
}
exports.PurgeService = PurgeService;
//# sourceMappingURL=PurgeService.js.map