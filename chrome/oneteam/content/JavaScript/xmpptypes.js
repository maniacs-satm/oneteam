/**
 * Class which encapsulate Jabber ID.
 *
 * @ctor
 *
 * Create new JID object.
 *
 * This constructor needs a node, domain and optional resource
 * argument. Alternatively you can pass just one argument with jid in
 * standard string format ("node@domain/resource").
 *
 * @tparam String node Node part of jid, or string with whole jid.
 * @tparam String domain Domain part of jid.
 * @tparam String resource Resource part of jid. <em>(optional)</em>
 */
function JID(node, domain, resource)
{
    if (arguments.length == 1) {
        if (node instanceof JID)
            return node;
        if (this._cache[node])
            return this._cache[node];

        var atIdx = node.indexOf("@");
        var slashIdx = ~(~node.indexOf("/", atIdx) || ~node.length);

        [node, domain, resource] = [node.substring(0, atIdx),
            node.substring(atIdx+1, slashIdx), node.substring(slashIdx+1)];
    }

    this.shortJID = (node ? node+"@" : "") + domain;
    this.longJID = this.shortJID + (resource ? "/"+resource : "");

    if (this._cache[this.longJID])
        return this._cache[this.longJID];

    this.node = node || null;
    this.domain = domain;
    this.resource = resource || null;
    this._cache[this.longJID] = this;
    return this;
}

JID.prototype =
{
    _cache: {},
    /**
     * Node part of jid.
     * @type String
     * @public
     */
    node: null,

    /**
     * Domain part of jid.
     * @type String
     * @public
     */
    domain: null,

    /**
     * Resource part of jid.
     * @type String
     * @public
     */
    resource: null,

    /**
     * Convert JID to string.
     * @tparam String type If equals to \c "short" string format string
     *   is returned i.e without resource part.
     * @treturn String JID in string format. <em>(optional)</em>
     * @public
     */
    toString: function(type)
    {
        if (type == "short")
            return this.shortJID;
        return this.longJID;
    },

    /**
     * Returns JID object generated from this jid short form.
     *
     * @treturn  JID  Object generated from this jid short form or this
     *   object if it is is short form already.
     *
     * @public
     */
    getShortJID: function()
    {
        if (!this.resource)
            return this;
        return new JID(this.node, this.domain);
    },

    createFullJID: function(resource)
    {
        return new JID(this.node, this.domain, resource);
    },

    get normalizedJID()
    {
        var p = this.__proto__;
        this.__proto__ = Object.prototype;

        this.normalizedJID = new JID(this.node && this.node.toLowerCase(),
                                     this.domain.toLowerCase(),
                                     this.resource && this.resource.toLowerCase());
        this.__proto__ = p;

        return this.normalizedJID;
    }
}

function XMPPDataAccessorBase()
{
}

_DECL_(XMPPDataAccessorBase).prototype =
{
    _fetchXMPPData: function(stateId, pktGeneratorFun, pktParserFun,
                             onDataFetchedFun, forceUpdate, clientCallback)
    {
        var stateObj;

        if (!this[stateId]) {
            stateObj = this[stateId] =
                { callbacks: [], pktParser: pktParserFun, onDataFetchedFun: onDataFetchedFun };

            stateObj.callback = new Callback(this._fetchXMPPDataDone, this).
                addArgs(stateObj).fromCall();
        } else
            stateObj = this[stateId];

        if (!clientCallback)
            return stateObj.value;

        if (stateObj.value == null || forceUpdate) {
            stateObj.callbacks.push(clientCallback);
            if (stateObj.callbacks.length == 1)
                con.send(pktGeneratorFun.call(this), stateObj.callback);
        } else
            clientCallback(stateObj.value);

        return stateObj.value;
    },

    _storeXMPPData: function(stateId, pktParserFun, onDataFetchedFun, pkt)
    {
        var stateObj;

        if ((stateObj = this[stateId]) == null) {
            stateObj = this[stateId] =
                { callbacks: [], pktParser: pktParserFun, onDataFetchedFun: onDataFetchedFun };

            stateObj.callback = new Callback(this._fetchXMPPDataDone, this).
                addArgs(stateObj).fromCall();
        }

        stateObj.value = stateObj.pktParser ? stateObj.pktParser(pkt) : pkt;
        if (stateObj.onDataFetchedFun)
            stateObj.onDataFetchedFun.call(this, pkt, stateObj.value);
    },

    _fetchXMPPDataDone: function(stateObj, pkt)
    {
        stateObj.value = stateObj.pktParser ? stateObj.pktParser(pkt) : pkt;

        for (var i = 0 ; i < stateObj.callbacks.length; i++)
            try {
                stateObj.callbacks[i](stateObj.value);
            } catch (ex) { report("developer", "error", ex, stateObj.callbacks[i]) }

        stateObj.callbacks = [];
        if (stateObj.onDataFetchedFun)
            stateObj.onDataFetchedFun.call(this, pkt, stateObj.value);
    }
}

function XMPPDataAccessor(prefix, pktGeneratorFun, pktParserFun)
{
    var fun = eval("(function "+prefix+"Accessor(){})");
    _DECL_NOW_(fun, XMPPDataAccessorBase);

    fun.prototype["get"+prefix] = function(forceUpdate, callbacks) {
        return this._fetchXMPPData("_"+prefix+"State", pktGeneratorFun, pktParserFun,
                                   null, null, forceUpdate, callbacks);
    }
    return fun;
}

function vCardDataAccessor()
{
}

_DECL_(vCardDataAccessor, null, XMPPDataAccessorBase).prototype =
{
    avatarRetrieved: false,

    getVCard: function(forceUpdate, callback)
    {
        return this._fetchXMPPData("_vCardAccessorState", this._generateVCardPkt,
                                   null, this._handleVCard, forceUpdate, callback);
    },

    _handleVCard: function(pkt, value)
    {
        var photo, photos = pkt.getNode().getElementsByTagName("PHOTO");

        for (var i = 0; i < photos.length; i++) {
            var binval = photos[i].getElementsByTagName("BINVAL")[0];
            if (binval && binval.textContent) {
                photo = binval.textContent.replace(/\s/g,"");
                break;
            }
        }

        this.avatarRetrieved = true;

        if (!photo) {
            this.avatarHash = null;
            this.avatar = null;
            this.modelUpdated("avatar");
            return;
        }

        photo = atob(photo);
        this.avatarHash = hex_sha1(photo);
        account.cache.setValue("avatar-"+this.avatarHash, photo,
                               new Date(Date.now()+30*24*60*60*1000), true);
        this.avatar = account.cache.getValue("avatar-"+this.avatarHash, true);
        this.modelUpdated("avatar");
    },

    _generateVCardPkt: function()
    {
        var iq = new JSJaCIQ();
        iq.setIQ(this.jid, null, 'get');
        iq.getNode().appendChild(iq.getDoc().createElementNS('vcard-temp', 'vCard'));
        return iq;
    }
}

function DiscoCacheEntry(jid, node)
{
    if (DiscoCacheEntry.prototype.cache[jid])
        return DiscoCacheEntry.prototype.cache[jid]
    this.jid = jid;
    this.node = node;
    DiscoCacheEntry.prototype.cache[jid] = this;
    return this;
}

_DECL_(DiscoCacheEntry).prototype =
{
    cache: {},

    requestDiscoItems: function(forceUpdate, callback)
    {
        if (!callback)
            return this.discoItems;

        if (!this.discoItems || forceUpdate) {
            if (!this.discoItemsCallbacks) {
                var iq = new JSJaCIQ();
                iq.setIQ(this.discoJID || this.jid, null, "get");
                iq.setQuery("http://jabber.org/protocol/disco#items");
                if (this.node)
                    iq.getQuery().setAttribute("node", this.node);
                con.send(iq, function(pkt, _this) { _this.gotDiscoItems(pkt) }, this);
                this.discoItemsCallbacks = [callback];
            } else
                this.discoItemsCallbacks.push(callback);
            return null;
        }
        callback(this.discoItems);

        return this.discoItems;
    },

    requestDiscoInfo: function(name, forceUpdate, callback)
    {
        if (!callback)
            return name ? this.discoFeatures ? name in this.discoFeatures : null :
                this.discoIdentity;

        if (!this.discoFeatures || forceUpdate) {
            if (!this.discoInfoCallbacks) {
                var iq = new JSJaCIQ();
                iq.setIQ(this.discoJID || this.jid, null, "get");
                iq.setQuery("http://jabber.org/protocol/disco#info");
                if (this.node)
                    iq.getQuery().setAttribute("node", this.node);
                con.send(iq, function(pkt, _this) { _this.gotDiscoInfo(pkt) }, this);
                this.discoInfoCallbacks = [[name, callback]];
            } else
                this.discoInfoCallbacks.push([name, callback]);
            return null;
        }
        var ret = name ? this.discoFeatures ? name in this.discoFeatures : null :
            this.discoIdentity;
        callback(ret);

        return ret;
    },

    gotDiscoItems: function(pkt)
    {
        var items = pkt.getQuery().
            getElementsByTagNameNS("http://jabber.org/protocol/disco#items", "item");

        this.discoItems = [];
        for (var i = 0; i < items.length; i++)
            this.discoItems.push(new DiscoItem(items[i].getAttribute("jid"),
                                               items[i].getAttribute("name"),
                                               items[i].getAttribute("node")));

        for (var i = 0; i < this.discoItemsCallbacks.length; i++)
            this.discoItemsCallbacks[i].call(null, this.discoItems);

        delete this.discoItemsCallbacks;
    },

    gotDiscoInfo: function(pkt)
    {
        var features = pkt.getQuery().getElementsByTagName("feature");
        var identity = pkt.getQuery().getElementsByTagName("identity")[0];

        if (identity)
            this.discoIdentity = {
                name: identity.getAttribute("name"),
                type: identity.getAttribute("type"),
                category: identity.getAttribute("category")
            };

        this.discoFeatures = {};
        for (var i = 0; i < features.length; i++)
            this.discoFeatures[features[i].getAttribute("var")] = 1;

        for (i = 0; i < this.discoInfoCallbacks.length; i++) {
            var [name, callback] = this.discoInfoCallbacks[i];

            callback(name ? this.discoFeatures ? name in this.discoFeatures : null :
                     this.discoIdentity);
        }
        delete this.discoInfoCallbacks;
    }
}

function DiscoItem(jid, name, node)
{
    this.jid = jid;
    this.name = name;
    this.node = node;
}

_DECL_(DiscoItem).prototype =
{
    hasDiscoFeature: function(name, forceUpdate, callback)
    {
        if (!this._discoCacheEntry)
            this._discoCacheEntry = new DiscoCacheEntry(this.discoJID || this.jid);
        return this._discoCacheEntry.requestDiscoInfo(name, forceUpdate,
            callback && new Callback(callback).fromCons(3));
    },

    getDiscoIdentity: function(forceUpdate, callback)
    {
        if (!this._discoCacheEntry)
            this._discoCacheEntry = new DiscoCacheEntry(this.discoJID || this.jid);
        return this._discoCacheEntry.requestDiscoInfo(null, forceUpdate,
            callback && new Callback(callback).fromCons(2));
    },

    getDiscoItems: function(forceUpdate, callback)
    {
        if (!this._discoCacheEntry)
            this._discoCacheEntry = new DiscoCacheEntry(this.discoJID || this.jid);
        return this._discoCacheEntry.requestDiscoItems(forceUpdate,
            callback && new Callback(callback).fromCons(2));
    },

    getDiscoItemsByCategory: function(category, type, forceUpdate, callback)
    {
        if (callback)
            this.getDiscoItems(forceUpdate,
                new Callback(this._gotDiscoItems, this).fromCons(0,3).
                    addArgs(new Callback(callback).fromCons(4)));

        return this._getDiscoItemsByCategory(category);
    },

    _gotDiscoItems: function(items, category, type, forceUpdate, callback)
    {
        var count = {value: items.length};
        for (var i = 0; i < items.length; i++)
            items[i].getDiscoIdentity(forceUpdate,
                new Callback(this._gotDiscoIdentity, this).
                    addArgs(category, type, callback, count));
    },

    _gotDiscoIdentity: function(identity, category, type, callback, count)
    {
        if (--count.value == 0)
            callback.call(null, this._getDiscoItemsByCategory(category, type));
    },

    _getDiscoItemsByCategory: function(category, type)
    {
        if (!this.getDiscoItems())
            return [];

        var i, ret = [], items = this.getDiscoItems();
        for (i = 0; i < items.length; i++) {
            var id = items[i].getDiscoIdentity();
            if (id && (category == null || id.category == category) &&
                    (type == null || id.type == type))
                ret.push(items[i]);
        }
        return ret;
    }
}