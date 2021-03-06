"use strict";

var ErrorCase = require("../common/Error");

const LOG_ID = "BUBBLES - ";

/**
 * @class
 * @name Bubbles
 * @description
 *      This service manages multi-party communications (aka bubbles). Bubbles allow to chat and to share files with several participants.<br><br>
 *      Each user can create bubbles and invite other users to be part of it.
 *      <br><br>
 *      The main methods proposed in that module allow to: <br>
 *      - Create a new bubble <br>
 *      - Invite users in a bubble or remove them <br>
 *      - Manage a bubble: close, delete <br>
 *      - Leave a bubble <br>
 *      - Accept or decline an invitation to join a bubble <br>
 *      - Change the custom data attached to a bubble
 */
class Bubbles {

    constructor(_eventEmitter, _logger) {
        this._xmpp = null;
        this._rest = null;
        this._bubbles = null;
        this._eventEmitter = _eventEmitter;
        this._logger = _logger;
    }

    start(_xmpp, _rest) {
        var that = this;

        this._logger.log("debug", LOG_ID + "(start) _entering_");

        return new Promise(function(resolve, reject) {
            try {
                that._xmpp = _xmpp;
                that._rest = _rest;
                that._bubbles = [];
                that._eventEmitter.on("rainbow_invitationreceived", that._onInvitationReceived.bind(that));
                that._eventEmitter.on("rainbow_affiliationchanged", that._onAffiliationChanged.bind(that));
                that._eventEmitter.on("rainbow_ownaffiliationchanged", that._onOwnAffiliationChanged.bind(that));
                that._logger.log("debug", LOG_ID + "(start) _exiting_");
                resolve();
            }
            catch (err) {
                that._logger.log("debug", LOG_ID + "(start) _exiting_");
                reject();
            }
        });
    }

    stop() {
        var that = this;

        this._logger.log("debug", LOG_ID + "(stop) _entering_");

        return new Promise(function(resolve) {
            try {
                that._xmpp = null;
                that._rest = null;
                that._bubbles = null;
                that._eventEmitter.removeListener("rainbow_invitationreceived", that._onInvitationReceived);
                that._eventEmitter.removeListener("rainbow_affiliationchanged", that._onAffiliationChanged);
                that._eventEmitter.removeListener("rainbow_ownaffiliationchanged", that._onOwnAffiliationChanged);
                that._logger.log("debug", LOG_ID + "(stop) _exiting_");
                resolve();
            } catch (err) {
                that._logger.log("debug", LOG_ID + "(stop) _exiting_");
                reject(err);
            }
        });
    }

    /**
     * @public
     * @method createBubble
     * @instance
     * @param {string} name  The name of the bubble to create
     * @param {string} description  The description of the bubble to create
     * @param {boolean} withHistory If true, a newcomer will have the complete messages history since the beginning of the bubble. False if omitted
     * @return {Bubble} A bubble
     * @memberOf Bubbles
     * @description
     *  Create a new bubble
     */
    createBubble(name, description, withHistory) {

        var that = this;

        return new Promise((resolve, reject) => {

            that._logger.log("debug", LOG_ID + "(createBubble) _entering_");

            if (typeof withHistory === "undefined") {
                withHistory = false;
            }
        
            if (!name) {
                that._logger.log("warn", LOG_ID + "(createBubble) bad or empty 'name' parameter", name);
                that._logger.log("debug", LOG_ID + "(createBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else if (!description) {
                that._logger.log("warn", LOG_ID + "(createBubble) bad or empty 'description' parameter", description);
                that._logger.log("debug", LOG_ID + "(createBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else {
                that._rest.createBubble(name, description, withHistory).then((bubble) => {
                    that._logger.log("debug", LOG_ID + "(createBubble) creation successfull");

                    that._eventEmitter.once("rainbow_onbubblepresencechanged", () => {
                        that._logger.log("debug", LOG_ID + "(createBubble) bubble presence successfull");
                        that._logger.log("debug", LOG_ID + "(createBubble) _exiting_");
                        that._bubbles.push(bubble);
                        resolve(bubble);
                    });

                    that._xmpp.sendInitialBubblePresence(bubble.jid);
                    
                }).catch((err) => {
                    that._logger.log("error", LOG_ID + "(createBubble) error");
                    that._logger.log("debug", LOG_ID + "(createBubble) _exiting_");
                    reject(err);
                });    
            }
        });
    }

    /**
     * @public
     * @method isBubbleClosed
     * @instance
     * @param {Bubble} bubble  The bubble to check
     * @return {boolean} True if the bubble is closed 
     * @memberof Bubbles
     * @description
     *  Check if the bubble is closed or not.
     */
    isBubbleClosed(bubble) {

        this._logger.log("debug", LOG_ID + "(isBubbleClosed) _entering_");
        
        if (!bubble) {
            this._logger.log("warn", LOG_ID + "(isBubbleClosed) bad or empty 'bubble' parameter", bubble);
            this._logger.log("debug", LOG_ID + "(isBubbleClosed) _exiting_");
            throw new Error(ErrorCase.BAD_REQUEST.msg);
        } else {
            var activeUser = bubble.users.find((user) => {
                return user.status === "invited" || user.status === "accepted";
            });

            this._logger.log("debug", LOG_ID + "(isBubbleClosed) _exiting_");
            if (activeUser) {
                return false;
            }
            
            return true;
        }
    }

    /**
     * @public
     * @method deleteBubble
     * @instance
     * @param {Bubble} bubble  The bubble to delete
     * @return {Error.OK} An object representing the result (OK or Error)
     * @memberof Bubbles
     * @description
     *  Delete a owned bubble. When the owner deletes a bubble, the bubble and its content is no more accessible by all participants.
     */
    deleteBubble(bubble) {
        var that = this;

        return new Promise(function(resolve, reject) {
            that._logger.log("debug", LOG_ID + "(deleteBubble) _entering_");

            if (!bubble) {
                that._logger.log("warn", LOG_ID + "(deleteBubble) bad or empty 'bubble' parameter", bubble);
                that._logger.log("debug", LOG_ID + "(deleteBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else {
                that.closeBubble(bubble).then((updatedBubble) => {
                    that._rest.deleteBubble(updatedBubble.id).then(function() {
                        that._bubbles.splice(that._bubbles.findIndex(function(el) {
                            return el.id === updatedBubble.id;                
                        }), 1);
                        that._logger.log("info", LOG_ID + "(deleteBubble) delete successfull");
                        that._logger.log("debug", LOG_ID + "(deleteBubble) _exiting_");
                        resolve(ErrorCase.OK);
                    }).catch(function(err) {
                        that._logger.log("error", LOG_ID + "(deleteBubble) error");
                        that._logger.log("debug", LOG_ID + "(deleteBubble) _exiting_");
                        reject(err);
                    });
                }).catch((err) => {
                    reject(err);
                });    
            }
        });
    }

    /**
     * @public
     * @method closeBubble
     * @instance
     * @param {Bubble} bubble The Bubble to close
     * @return {Bubble} The bubble closed
     * @memberof Bubbles
     * @description
     *  Close a owned bubble. When the owner closes a bubble, the bubble is archived and only accessible in read only mode for all participants.
     */
    closeBubble(bubble) {
        var that = this;

        let unsubscribeParticipants = (participantsIDList) => {

            return new Promise((resolve, reject) => {

                var participantID = participantsIDList.shift();

                if (participantID) {
                    return that.removeContactFromBubble({id: participantID}, bubble).then( () => {
                        that._logger.log("debug", LOG_ID + "(closeBubble) Participant " + participantID + " unsubscribed");
                        return unsubscribeParticipants(participantsIDList).then(() => {
                            resolve();
                        }).catch((err) => {
                            reject(err);
                        }); 
                    }).catch((err) => {
                        reject(err);
                    });
                }
                resolve();
            });
        };

        return new Promise(function(resolve, reject) {
            that._logger.log("debug", LOG_ID + "(closeBubble) _entering_");

            if (!bubble) {
                that._logger.log("warn", LOG_ID + "(closeBubble) bad or empty 'bubble' parameter", bubble);
                that._logger.log("debug", LOG_ID + "(closeBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else if (that.isBubbleClosed(bubble)) {
                that._logger.log("info", LOG_ID + "(closeBubble) bubble is already closed", bubble);
                resolve(bubble);
            } else {
                var queue = [];
                bubble.users.forEach(function(user) {
                    if (user.userId !== that._rest.userId) {
                        // unsubscribe everyone except the connected user
                        queue.push(user.userId);
                    }
                });

                // unsubscribe the connected user
                queue.push(that._rest.userId);

                unsubscribeParticipants(queue).then(() => {
                    that._logger.log("info", LOG_ID + "(closeBubble) all users have been unsubscribed from bubble. Bubble is closed");

                    that._rest.getBubble(bubble.id).then(function(bubbleUpdated) {
                        // Update the existing local bubble stored
                        var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
                        that._bubbles[foundIndex] = bubbleUpdated;

                        that._logger.log("debug", LOG_ID + "(closeBubble) _exiting_");
                        resolve(bubbleUpdated);
                    });
                }).catch( (err) => {
                    reject(err);
                });
            }
        });
    }

    /**
     * @public
     * @method leaveBubble
     * @instance
     * @param {Bubble} bubble  The bubble to leave
     * @return {Object} The operation result
     * @memberof Bubbles
     * @description
     *  Leave a bubble. If the connected user is a moderator, an other moderator should be still present in order to leave this bubble.
     */
    leaveBubble(bubble) {

        var that = this;

        return new Promise(function(resolve, reject) {
            that._logger.log("debug", LOG_ID + "(leaveBubble) _entering_");

            var otherModerator = null;

            if (bubble) {
                otherModerator = bubble.users.find((user) => {
                    return user.privilege === "moderator" && user.status === "accepted" && user.userId !== that._rest.userId;
                });
            }

            if (!bubble) {
                that._logger.log("warn", LOG_ID + "(leaveBubble) bad or empty 'bubble' parameter", bubble);
                that._logger.log("debug", LOG_ID + "(leaveBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else if (!otherModerator) {
                that._logger.log("warn", LOG_ID + "(leaveBubble) can't leave a bubble if no other active moderator");
                that._logger.log("debug", LOG_ID + "(leaveBubble) _exiting_");
                reject(ErrorCase.FORBIDDEN);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else {
                that._rest.leaveBubble(bubble.id).then(function(json) {
                    that._logger.log("info", LOG_ID + "(leaveBubble) leave successfull");
                    that._xmpp.sendUnavailableBubblePresence(bubble.jid);
                    that._logger.log("debug", LOG_ID + "(leaveBubble) _exiting_");
                    resolve(json);
                    
                }).catch(function(err) {
                    that._logger.log("error", LOG_ID + "(leaveBubble) error");
                    that._logger.log("debug", LOG_ID + "(leaveBubble) _exiting_");
                    reject(err);
                });
            }
        });
    }

    /**
     * @public
     * @method inviteContactToBubble
     * @instance
     * @param {Contact} contact         The contact to invite
     * @param {Bubble} bubble           The bubble
     * @param {boolean} isModerator     True to add a contact as a moderator of the bubble
     * @param {boolean} withInvitation  If true, the contact will receive an invitation and will have to accept it before entering the bubble. False to force the contact directly in the bubble without sending an invitation.
     * @param {string} reason        The reason of the invitation (optional)
     * @return {Bubble} The bubble updated with the new invitation
     * @memberof Bubbles
     * @description
     *  Invite a contact in a bubble
     */
    inviteContactToBubble(contact, bubble, isModerator, withInvitation, reason) {
        var that = this;

        return new Promise(function(resolve, reject) {
            that._logger.log("debug", LOG_ID + "(inviteContactToBubble) _entering_");

            if (!contact) {
                that._logger.log("warn", LOG_ID + "(inviteContactToBubble) bad or empty 'contact' parameter", contact);
                that._logger.log("debug", LOG_ID + "(inviteContactToBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else if (!bubble) {
                that._logger.log("warn", LOG_ID + "(inviteContactToBubble) bad or empty 'bubble' parameter", bubble);
                that._logger.log("debug", LOG_ID + "(inviteContactToBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else {
                that._rest.inviteContactToBubble(contact.id, bubble.id, isModerator, withInvitation, reason).then(function() {
                    that._logger.log("info", LOG_ID + "(inviteContactToBubble) invitation successfully sent");

                    that._rest.getBubble(bubble.id).then(function(bubbleUpdated) {

                        // Update the existing local bubble stored
                        var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
                        that._bubbles[foundIndex] = bubbleUpdated;

                        that._logger.log("debug", LOG_ID + "(inviteContactToBubble) _exiting_");
                        resolve(bubbleUpdated);
                    });
                    
                }).catch(function(err) {
                    that._logger.log("error", LOG_ID + "(inviteContactToBubble) error");
                    that._logger.log("debug", LOG_ID + "(inviteContactToBubble) _exiting_");
                    reject(err);
                });
            }
        });
    }

     /**
     * @public
     * @method removeContactFromBubble
     * @instance
     * @param {Contact} contact The contact to remove
     * @param {Bubble} bubble   The destination bubble
     * @return {Object|null} The bubble object or an error object depending on the result
     * @memberof Bubbles
     * @description
     *    Remove a contact from a bubble <br/>
     *    Return a promise
     */
    removeContactFromBubble(contact, bubble) {

        var that = this;

        return new Promise(function(resolve, reject) {

            if (!contact) {
                that._logger.log("warn", LOG_ID + "(removeContactFromBubble) bad or empty 'contact' parameter", contact);
                that._logger.log("debug", LOG_ID + "(removeContactFromBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else if (!bubble) {
                that._logger.log("warn", LOG_ID + "(removeContactFromBubble) bad or empty 'bubble' parameter", bubble);
                that._logger.log("debug", LOG_ID + "(removeContactFromBubble) _exiting_");
                reject(ErrorCase.BAD_REQUEST);
                throw new Error(ErrorCase.BAD_REQUEST.msg);
            } else {
            
                var contactStatus = "";

                bubble.users.forEach(function(user) {
                    if (user.userId === contact.id) {
                        contactStatus = user.status;
                    }
                });

                switch (contactStatus) {
                    case "invited":
                        that._rest.removeInvitationOfContactToBubble(contact.id, bubble.id).then(function(bubbleUpdated) {
                            that._logger.log("info", LOG_ID + "(removeContactFromBubble) removed successfully");
                            
                            // Update the existing local bubble stored
                            var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
                            that._bubbles[foundIndex] = bubbleUpdated;
                            
                            that._logger.log("debug", LOG_ID + "(removeContactFromBubble) _exiting_");
                            resolve(bubbleUpdated);
                        }).catch(function(err) {
                            that._logger.log("error", LOG_ID + "(removeContactFromBubble) error", err);
                            that._logger.log("debug", LOG_ID + "(removeContactFromBubble) _exiting_");
                            reject(err);
                        });
                        break;
                    case "accepted":
                        that._rest.unsubscribeContactFromBubble(contact.id, bubble.id).then(function(bubbleUpdated) {
                            that._logger.log("debug", LOG_ID + "(removeContactFromBubble) removed successfully");

                            // Update the existing local bubble stored
                            var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
                            that._bubbles[foundIndex] = bubbleUpdated;
                            
                            that._logger.log("debug", LOG_ID + "(removeContactFromBubble) _exiting_");
                            resolve(bubbleUpdated);
                        }).catch(function(err) {
                            that._logger.log("error", LOG_ID + "(removeContactFromBubble) error", err);
                            that._logger.log("debug", LOG_ID + "(removeContactFromBubble) _exiting_");
                            reject(err);
                        });
                        break;
                    default:
                        that._logger.log("warn", LOG_ID + "(removeContactFromBubble) contact not found in that bubble");
                        that._logger.log("debug", LOG_ID + "(removeContactFromBubble) _exiting_");
                        resolve(bubble);
                        break;
                }
            }
        });
    }

    /**
     * @private
     * @description
     *      Internal method
     */
    getBubbles() {
        var that = this;
        
        return new Promise(function(resolve, reject) {

            that._logger.log("debug", LOG_ID + "(getBubbles) _entering_");

            that._rest.getBubbles().then(function(listOfBubbles) {
                that._bubbles = listOfBubbles;
                that._logger.log("info", LOG_ID + "(getBubbles) get successfully");
                
                listOfBubbles.forEach(function(bubble) {

                    var users = bubble.users;
                    users.forEach(function(user) {
                        if (user.userId === that._rest.userId && user.status === "accepted") {
                            that._logger.log("debug", LOG_ID + "(getBubbles) send initial presence to room");
                            that._xmpp.sendInitialBubblePresence(bubble.jid);
                        }
                    });
                });

                that._logger.log("debug", LOG_ID + "(getBubbles) _exiting_");
                resolve();
            }).catch(function(err) {
                that._logger.log("error", LOG_ID + "(getBubbles) error", err);
                that._logger.log("debug", LOG_ID + "(getBubbles) _exiting_");
                reject(err);
            });
        });
    }
    
    /**
     * @public
     * @method getAll
     * @return {Bubble[]} The list of existing bubbles
     * @memberof Bubbles
     * @description
     *  Return the list of existing bubbles
     */
    getAll() {
        return this._bubbles;
    }
    
    /**
     * @public
     * @method getBubbleById
     * @param {string} id the id of the bubble
     * @return {Bubble} The bubble found or null
     * @memberof Bubbles
     * @description
     *  Get a bubble by its ID
     */
    getBubbleById(id) {

        if (!id) {
            this._logger.log("debug", LOG_ID + "(getBubbleById) bad or empty 'id' parameter", id);
            throw new Error(ErrorCase.BAD_REQUEST.msg);
        }

        var bubbleFound = this._bubbles.find(function(bubble) {
            return (bubble.id === id);
        });
        return bubbleFound;
    }

    /**
     * @public
     * @method getBubbleByJid
     * @param {string} jid the JID of the bubble
     * @return {Bubble} The bubble found or null
     * @memberof Bubbles
     * @description
     *  Get a bubble by its JID
     */
    getBubbleByJid(jid) {

        if (!jid) {
            this._logger.log("debug", LOG_ID + "(getBubbleByJid) bad or empty 'jid' parameter", jid);
            throw new Error(ErrorCase.BAD_REQUEST.msg);
        }

        var bubbleFound = this._bubbles.find(function(bubble) {
            return (bubble.jid === jid);
        });
        return bubbleFound;
    }

    /**
     * @public
     * @method acceptInvitationToJoinBubble
     * @param {Bubble} bubble The Bubble to join
     * @return {Bubble} The bubble updated
     * @description
     *  Accept an invitation to join a bubble
     *  Return a Promise
     * @memberof Bubbles
     */
    acceptInvitationToJoinBubble(bubble) {
        
        let that = this;

        this._logger.log("debug", LOG_ID + "(acceptInvitationToJoinBubble) _entering_");
        
        if (!bubble) {
            this._logger.log("debug", LOG_ID + "(acceptInvitationToJoinBubble) bad or empty 'bubble' parameter", bubble);
            throw new Error(ErrorCase.BAD_REQUEST.msg);
        }

        return new Promise((resolve, reject) => {

            that._rest.acceptInvitationToJoinBubble(bubble.id).then((invitationStatus) => {
                that._logger.log("info", LOG_ID + "(acceptInvitationToJoinBubble) invitation accepted", invitationStatus);

                //Send initial bubble presence
                that._xmpp.sendInitialBubblePresence(bubble.jid);

                that._rest.getBubble(bubble.id).then((bubbleUpdated) => {
                    // Update the existing local bubble stored
                    var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
                    that._bubbles[foundIndex] = bubbleUpdated;

                    resolve(bubbleUpdated);
                });
                
            }).catch((err) => {
                that._logger.log("error", LOG_ID + "(acceptInvitationToJoinBubble) error", err);
                that._logger.log("debug", LOG_ID + "(acceptInvitationToJoinBubble) _exiting_");
                reject(err);
            });
        });
    }

    /**
     * @public
     * @method declineInvitationToJoinBubble
     * @param {Bubble} bubble The Bubble to decline
     * @return {Bubble} The bubble updated
     * @description
     *  Decline an invitation to join a bubble
     *  Return a Promise
     * @memberof Bubbles
     */
    declineInvitationToJoinBubble(bubble) {
        
        let that = this;

        this._logger.log("debug", LOG_ID + "(declineInvitationToJoinBubble) _entering_");
        
        if (!bubble) {
            this._logger.log("debug", LOG_ID + "(declineInvitationToJoinBubble) bad or empty 'bubble' parameter", bubble);
            throw new Error(ErrorCase.BAD_REQUEST.msg);
        }

        return new Promise((resolve, reject) => {

            that._rest.declineInvitationToJoinBubble(bubble.id).then((invitationStatus) => {
                that._logger.log("info", LOG_ID + "(declineInvitationToJoinBubble) invitation declined", invitationStatus);

                that._rest.getBubble(bubble.id).then((bubbleUpdated) => {
                    // Update the existing local bubble stored
                    var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
                    that._bubbles[foundIndex] = bubbleUpdated;

                    resolve(bubbleUpdated);
                });
                
            }).catch((err) => {
                that._logger.log("error", LOG_ID + "(declineInvitationToJoinBubble) error", err);
                that._logger.log("debug", LOG_ID + "(declineInvitationToJoinBubble) _exiting_");
                reject(err);
            });
        });
    }

    /**
     * @public
     * @method getAllPendingBubbles
     * @return {Bubble[]} An array of Bubbles not accepted or declined
     * @description
     *  Get the list of Bubbles that have a pending invitation not yet accepted of declined
     * @memberof Bubbles
     */
    getAllPendingBubbles() {

        let that = this;

        let pendingBubbles = this._bubbles.filter((bubble) => {
            
            let invitation = bubble.users.filter((user) => {
                return (user.userId === that._rest.userId && user.status === "invited");
            });
            return invitation.length > 0;
        });
        return pendingBubbles;
    }

    /**
     * @public
     * @method setBubbleCustomData
     * @param {Bubble} bubble The Bubble
     * @param {Object} customData Bubble's custom data area. key/value format. Maximum and size are server dependent
     * @return {Bubble} The bubble updated with the custom data set
     * @description
     *  Modify all custom data at once in a bubble
     *  To erase all custom data, put {} in customData
     *  Return a Promise
     * @memberof Bubbles
     */
    setBubbleCustomData(bubble, customData) {
        
        let that = this;

        this._logger.log("debug", LOG_ID + "(setBubbleCustomData) _entering_");
        
        if (!bubble) {
            this._logger.log("debug", LOG_ID + "(setBubbleCustomData) bad or empty 'bubble' parameter", bubble);
            throw new Error(ErrorCase.BAD_REQUEST.msg);
        }

        return new Promise((resolve, reject) => {

            that._rest.setBubbleCustomData(bubble.id, customData).then((customDataSet) => {
                that._logger.log("info", LOG_ID + "(setBubbleCustomData) customData set", customDataSet);
                bubble.customData = customDataSet;
                resolve(bubble);
            }).catch((err) => {
                that._logger.log("error", LOG_ID + "(setBubbleCustomData) error", err);
                that._logger.log("debug", LOG_ID + "(setBubbleCustomData) _exiting_");
                reject(err);
            });
        });
    }

    /**
     * @private
     * @method _onInvitationReceived
     * @param {Object} invitation contains informations about bubble and user's jid
     * @memberof Bubbles
     * @description
     *      Method called when receiving an invitation to join a bubble
     */
    _onInvitationReceived(invitation) {
        let that = this;

        this._rest.getBubble(invitation.bubbleId).then( (bubbleUpdated) => {
            that._logger.log("debug", LOG_ID + "(_onInvitationReceived) invitation received from bubble", bubbleUpdated.name);

            // Store the new bubble
            var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
            if (foundIndex > -1) {
                that._bubbles[foundIndex] = bubbleUpdated;
            }
            else {
                that._bubbles.push(bubbleUpdated);
            }

            that._eventEmitter.emit("rainbow_invitationdetailsreceived", bubbleUpdated);
        });
    }

    /**
     * @private
     * @method _onAffiliationChanged
     * @param {Object} affiliation contains information about bubble and user's jid
     * @memberof Bubbles
     * @description
     *      Method called when affilitation to a bubble changed
     */
    _onAffiliationChanged(affiliation) {
        let that = this;

        this._rest.getBubble(affiliation.bubbleId).then( (bubbleUpdated) => {
            that._logger.log("debug", LOG_ID + "(_onAffiliationChanged) user affiliation changed for bubble", bubbleUpdated.name + " | " + affiliation.status);

            // Update the existing local bubble stored
            var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
            if (foundIndex > -1) {
                that._bubbles[foundIndex] = bubbleUpdated;
            }
            else {
                that._bubbles.push(bubbleUpdated);
            }

            that._eventEmitter.emit("rainbow_affiliationdetailschanged", bubbleUpdated);
        });
    }

    /**
     * @private
     * @method _onOwnAffiliationChanged
     * @param {Object} affiliation contains information about bubble and user's jid
     * @memberof Bubbles
     * @description
     *      Method called when the user affilitation to a bubble changed
     */
    _onOwnAffiliationChanged(affiliation) {
        let that = this;

        this._rest.getBubble(affiliation.bubbleId).then( (bubbleUpdated) => {
            that._logger.log("debug", LOG_ID + "(_onOwnAffiliationChanged) own affiliation changed for bubble", bubbleUpdated.name + " | " + affiliation.status);

            // Update the existing local bubble stored
            var foundIndex = that._bubbles.findIndex(bubbleItem => bubbleItem.id === bubbleUpdated.id);
            if (foundIndex > -1) {
                that._bubbles[foundIndex] = bubbleUpdated;
                if (affiliation.status === "accepted") {
                    that._xmpp.sendInitialBubblePresence(bubbleUpdated.jid);
                }
            }
            else {
                that._bubbles.push(bubbleUpdated);
                // New bubble, send initial presence
                that._xmpp.sendInitialBubblePresence(bubbleUpdated.jid);
            }

            that._eventEmitter.emit("rainbow_ownaffiliationdetailschanged", bubbleUpdated);
        });
    }
}

module.exports = Bubbles;
