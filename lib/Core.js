"use strict";

var Logger = require("./common/Logger");
var CPaaSService = require("./connection/CPaaSService");
var RESTService = require("./connection/RESTService");
var HTTPService = require("./connection/HttpService");
var XMPPService = require("./connection/XMPPService");
var IMService = require("./services/IM");
var PresenceService = require("./services/Presence");
var ContactsService = require("./services/Contacts");
var BubblesService = require("./services/Bubbles");
var AdminService = require("./services/Admin");
var FileServerService = require("./services/FileServerService");
var StateManager = require("./common/StateManager");

var Events = require("./common/Events");

var Options = require("./config/Options");
var Proxy = require("./Proxy");

var packageVersion = require("../package.json");

var _signin;
var _tokenSurvey;
var _retrieveInformation;

const LOG_ID = "CORE - ";

class Core {

    constructor(options) {

        _signin = (forceStopXMPP) => {
            var that = this;
            this.logger.log("debug", LOG_ID +  "(signin) _entering_");

            if (forceStopXMPP) {
                this.logger.log("debug", LOG_ID +  "(signin) stop the XMPP service");
                this._xmpp.stop();
            }

            return new Promise(function(resolve, reject) {

                var json = "";

                that._rest.signin().then(function(_json) {
                    json = _json; 
                    return that._xmpp.signin(that._rest.loggedInUser);
                }).then(function() {
                    that.logger.log("debug", LOG_ID +  "(signin) signed in successfully");
                    that.logger.log("debug", LOG_ID +  "(signin) _exiting_");
                    resolve(json);
                }).catch(function(err) {
                    that.logger.log("debug", LOG_ID +  "(signin) can't signed-in", err);
                    that.logger.log("debug", LOG_ID +  "(signin) _exiting_");
                    reject(err);
                });
            });
        };

        _retrieveInformation = () => {
            return new Promise((resolve, reject) => {
                return that._contacts.getRosters()
                .then(function() {
                    return that._bubbles.getBubbles();  
                }).then(function() {
                    return that.presence.sendInitialPresence();  
                }).then(function() {
                    return that.im.enableCarbon();
                }).then(function() {
                    return that._rest.getBots();
                }).then((bots) => {
                    that._botsjid = bots ? bots.map( (bot) => { return bot.jid;}) : [];
                }).then(function() {
                    resolve();
                }).catch((err) => {
                    reject(err);
                }); 
            });
        };

        _tokenSurvey = () => {

            var that = this;

            if (this.options.useCLIMode) {
                that.logger.log("info", LOG_ID +  "(tokenSurvey) No token survey in CLI mode");
                return;
            }

            var onTokenRenewed = function onTokenRenewed() {
                that.logger.log("info", LOG_ID +  "(tokenSurvey) token successfully renewed");
                that._rest.startTokenSurvey();
            };

            var onTokenExpired = function onTokenExpired() {
                that.logger.log("info", LOG_ID +  "(tokenSurvey) token expired. Signin required");
                that._eventEmitter.iee.removeListener("rainbow_tokenrenewed", onTokenRenewed);
                that._eventEmitter.iee.removeListener("rainbow_tokenexpired", onTokenExpired);
                that._eventEmitter.iee.emit("rainbow_signinrequired");
            };

            this._eventEmitter.iee.on("rainbow_tokenrenewed", onTokenRenewed);
            this._eventEmitter.iee.on("rainbow_tokenexpired", onTokenExpired);
            this._rest.startTokenSurvey();
        };

        var that = this;

        // Initialize the logger
        var loggerModule = new Logger(options);
        this.logger = loggerModule.log;
        this.logger.log("debug", LOG_ID + "(constructor) _entering_");
        this.logger.log("debug", LOG_ID + "(constructor) ------- SDK INFORMATION -------");

        this.logger.log("info", LOG_ID + " (constructor) SDK version: " + packageVersion.version);
        this.logger.log("info", LOG_ID + " (constructor) Node version: " + process.version);
        for (var key in process.versions) {
            this.logger.log("info", LOG_ID + " (constructor) " + key + " version: " + process.versions[key]);
        }
        this.logger.log("debug", LOG_ID + "(constructor) ------- SDK INFORMATION -------");

        // Initialize the options
        
        this.options = new Options(options, this.logger);
        this.options.parse();

        // Initialize the Events Emitter
        this._eventEmitter = new Events(that.logger, (jid) => {
             return that._botsjid.includes(jid);
            });
        this._eventEmitter.iee.on("rainbow_signinrequired", function() {
            that.signin(true);
        });

        this._eventEmitter.iee.on("rainbow_xmppreconnected", function() {
            //todo, check that REST part is ok too
            that._rest.reconnect().then(() => {
                that._stateManager.transitTo(that._stateManager.CONNECTED);
                return _retrieveInformation();
            }).then(()=> {
                that._stateManager.transitTo(that._stateManager.READY);
            }).catch(() => {
                that._stateManager.transitTo(that._stateManager.FAILED);
            });
        });

        this._eventEmitter.iee.on("rainbow_xmppreconnectingattempt", function() {
            that._stateManager.transitTo(that._stateManager.RECONNECTING);
        });

        this._eventEmitter.iee.on("rainbow_xmppdisconnect", function() {
            that._stateManager.transitTo(that._stateManager.DISCONNECTED);
        });

        if (this.options.useXMPP) {
            this.logger.log("info", LOG_ID + "(constructor) used in XMPP mode");
        }
        else {
            if (this.options.useCLIMode) {
                this.logger.log("info", LOG_ID + "(constructor) used in CLI mode");
            }
            else {
                this.logger.log("info", LOG_ID + "(constructor) used in HOOK mode");
            }
        }

        // Instantiate basic service
        this._proxy = new Proxy(this.options.proxyOptions, this.logger);
        this._http = new HTTPService(this.options.httpOptions, this.logger, this._proxy);
        this._rest = new RESTService(this.options.credentials, this._eventEmitter.iee, this.logger);
        this._xmpp = new XMPPService(this.options.xmppOptions, this.options.imOptions, this._eventEmitter.iee, this.logger, this._proxy);

        // Instantiate State Manager
        this._stateManager = new StateManager(this._eventEmitter, this.logger);

        // Instantiate others Services
        this._cpaas = new CPaaSService(this.options.applicationOptions, this.options.httpOptions, this._eventEmitter.iee, this.logger);
        this._im = new IMService(this._eventEmitter.iee, this.logger);
        this._presence = new PresenceService(this._eventEmitter.iee, this.logger);
        this._contacts = new ContactsService(this._eventEmitter.iee, this.logger);
        this._bubbles = new BubblesService(this._eventEmitter.iee, this.logger);
        this._admin = new AdminService(this._eventEmitter.iee, this.logger);
        this._fileServer = new FileServerService(this._eventEmitter.iee, this.logger);

        this._botsjid = [];
        
        this.logger.log("debug", LOG_ID + "(constructor) _exiting_");
    }

    start()
    {
        var that = this;

        this.logger.log("debug", LOG_ID +  "(start) _entering_");

        return new Promise(function(resolve, reject) {

            try {
            
                if (!that.options.hasCredentials) {
                    that.logger.log("error", LOG_ID +  "(start) No credentials. Stop loading...");
                    that.logger.log("debug", LOG_ID +  "(start) _exiting_");
                    reject("Credentials are missing. Check your configuration!");
                }
                else {
                    that.logger.log("debug", LOG_ID +  "(start) start all modules");
                    
                    that._stateManager.start().then(() => {
                        return that._http.start();
                    }).then(() => {
                        return that._cpaas.start(that._http);
                    }).then((token) => {
                        return that._rest.start(that._http, that._cpaas, token);
                    }).then(() => {
                        return that._xmpp.start(that.options.useXMPP);
                    }).then(() => {
                        return that._im.start(that._xmpp);
                    }).then(() => {
                        return that._presence.start(that._xmpp);
                    }).then(() => {
                        return that._contacts.start(that._xmpp, that._rest);
                    }).then(() => {
                        return that._bubbles.start(that._xmpp, that._rest);
                    }).then(() => {
                        return that._admin.start(that._xmpp, that._rest);
                    }).then(() => {
                        return that._fileServer.start(that._xmpp, that._rest);
                    }).then(() => {
                        that.logger.log("debug", LOG_ID +  "(start) all modules started successfully");
                        that._stateManager.transitTo(that._stateManager.STARTED);
                        that.logger.log("debug", LOG_ID +  "(start) _exiting_");
                        resolve();
                    }).catch((err) => {
                        that.logger.log("error", LOG_ID + "(start) error", err);
                        that.logger.log("debug", LOG_ID +  "(start) _exiting_");
                        reject(err);
                    });
                }

            } catch (err) {
                that.logger.log("error", LOG_ID + "(start)", err);
                that.logger.log("debug", LOG_ID +  "(start) _exiting_");
                reject(err);
            }
        });
    }

    signin(forceStopXMPP) {

        var that = this;
        return new Promise(function(resolve, reject) {

            var json = null;

            _signin(forceStopXMPP).then(function(_json) {
                json = _json;
                _tokenSurvey();
                that._stateManager.transitTo(that._stateManager.CONNECTED);
                return that.options.useCLIMode ? resolve() : _retrieveInformation();
            }).then(()=> {
                that._stateManager.transitTo(that._stateManager.READY);
                resolve(json);
            }).catch(function(err) {
                reject(err);
            });
        });
    }

    stop() {
        var that = this;
        this.logger.log("debug", LOG_ID +  "(stop) _entering_");

        return new Promise(function(resolve, reject) {

            that.logger.log("debug", LOG_ID +  "(stop) stop all modules");

            that._rest.stop().then(() => {
                return that._cpaas.stop(); 
            }).then(() => {
                return that._http.stop();
            }).then(() => {
                return that._xmpp.stop();
            }).then(() => {
                return that._im.stop();
            }).then(() => {
                return that._presence.stop();
            }).then(() => {
                return that._contacts.stop();
            }).then(() => {
                return that._bubbles.stop();
            }).then(() => {
                return that._admin.stop();
            }).then(() => {
                return that._fileServer.stop();
            }).then(() => {
                return that._stateManager.stop();
            }).then(() => {
                that.logger.log("debug", LOG_ID +  "(stop) _exiting_");
                resolve();
            }).catch((err) => {
                reject(err);
            });
        });
    }

    get presence() {
        return this._presence;
    }

    get im() {
        return this._im;
    }

    get contacts() {
        return this._contacts;
    }

    get bubbles() {
        return this._bubbles;
    }

    get admin() {
        return this._admin;
    }
    
    get fileServer() {
        return this._fileServer;
    }

    get events() {
        return this._eventEmitter.eee;
    }

    get rest() {
        return this._rest;
    }

    get state() {
        return this._stateManager.state;
    }

    get version() {
        return packageVersion.version;
    }
}

module.exports = Core;
