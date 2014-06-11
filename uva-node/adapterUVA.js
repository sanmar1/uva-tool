const fs = require('fs');
const path = require('path');
const util = require('./util');
const Adapter = require('./adapter');

const UVA_HOST = "uva.onlinejudge.org";
const SUBMIT_PAGE_PATH = "/index.php?option=com_onlinejudge&Itemid=25";
const SUBMIT_PATH = "/index.php?option=com_onlinejudge&Itemid=25&page=save_submission";
const PROBLEM_PATH = "/index.php?option=com_onlinejudge&Itemid=8&category=24&page=show_problem&problem=";

const UHUNT_HOST = 'uhunt.felix-halim.net';

const LOGIN_FORM_PATTERN =
    // group 1: form attribs
    // group 2: form HTML contents 
    /<form([^>]+?id\s*=\s*["']?\w*login[^>]*)>((?:.|\n)*?)<\/form>/i;

const INPUT_PATTERN =
    // group 1: attribs 
    /<input([^>]+?)\/?>/gi;

module.exports = (function(parentCls){
    // constructor
    function cls(app, acct)
    {
        // super constructor call
        parentCls.call(this, app, acct);

        // private instance fields
        var acctData = acct.getAdapterData();
        var adapData = app.getAdapterData('uva');
        var cookies = '';

        // private instance method
        function fetchUserId(callback)
        {
            var req;
            acctData.userId > 0 ? 
                callback(null, acctData.userId) : 
                (req = util.createReq(
                    'GET', 
                    UHUNT_HOST, 
                    '/api/uname2uid/'+acct.user(),
                    util.createEndCallback(function(buf){
                        req.removeListener('error', callback);
                        callback(null, acctData.userId = parseInt(buf));
                    })
                )).on('error', callback)
                 .end();
        };

        function fetchProbs(callback)
        {
            var req;
            adapData.probs && adapData.mapNum ? 
                callback(null, adapData.probs) :
                (req = util.createReq(
                    'GET',
                    UHUNT_HOST,
                    '/api/p',
                    util.createEndCallback(function(buf){
                        req.removeListener('error', callback);
                        var p;
                        try
                        {
                            p = JSON.parse(buf);
                        }
                        catch (e)
                        {
                            return callback(e);
                        }

                        var map    = {}; // maps prob ID to array index
                        var mapNum = {}; // maps prob # to array index
                        for (var i=0;i < p.length; i++)
                        {
                            var cur = p[i];
                            map   [cur[0].toString()] = i; // prob ID
                            mapNum[cur[1].toString()] = i; // prob #
                        }

                        adapData.map    = map;
                        adapData.mapNum = mapNum; 
                        callback(null, adapData.probs = p);
                    })
                )).on('error', callback)
                 .end(); 
        }

        // public instance method
        this.login = function(callback){
            var req, req2;
            var callback2 = util.createEndCallback(function(_, inMsg){    
                req2.removeListener('error', callback);
                cookies = util.getCookies(inMsg);
                callback();
            });

            var callback1 = util.createEndCallback(function(html, inMsg){
                req.removeListener('error', callback);
                var f = cls.parseForm(LOGIN_FORM_PATTERN, html);
                var err= null;
                if (!f)
                    err = ("cannot find HTML form");
                else if (!f.userField)
                    err = ("cannot find user field");
                else if (!f.passField)
                    err = ("cannot find pass field");
                else if (!f.action)
                    err = ("cannot find action");

                if (err)
                    return callback({message: err});

                var cookies = util.getCookies(inMsg);
                f.data[f.userField] = acct.user();
                f.data[f.passField] = acct.pass();

                (req2 = util.createReq('POST', UVA_HOST, f.action, callback2))
                    .on('error', callback)
                    .setHeader('Cookie', cookies);
                util.writePostData(req2, f.data);
            });

            (req = util.createReq('GET', UVA_HOST, '/', callback1))
                .on('error', callback)
                .end();            
        };

        /**
         * Finds existing source code files which names contain the 
         * problem number. 
         * @return array of file names which fit the criteria; empty if not found.
         */
        this.findFileNames = function(probNum){
            var found = [];
            var all = fs.readdirSync('.'); 
            var probNumStr = probNum+'';

            for (var i=0;i < all.length; i++)
            {
                var cur = all[i];
                var ext = util.getFileExt(cur).toLowerCase();
                var lang = util.getLang(ext);

                if (lang >= 0)
                {
                    var m = cur.match(/0*(\d+)/);
                    if (m && m[1] == probNumStr)
                        found.push(cur);        
                }
            }

            return found;
        };

        /**
         * Infers the prob num from a file path
         * @return undefined if not found; else the problem num as a string.
         */
        this.inferProbNum = function(filePath){
            var fileName = path.basename(filePath);
            var m = fileName.match(/0*(\d+)/);
            if (m) return m[1];
        };

        this._send = function(probNum, filePath, fileExt, callback){
            var req;
            var callback10 = util.createEndCallback(function(html){
                req.removeListener('error', callback);
                if (html.match(/not\s+authori[zs]ed/i))
                    callback({message: 'cannot login. password correct?'});
                else
                    callback();
            });

            var langVal = cls.getLangVal(util.getLang(fileExt.toLowerCase()));
            if (langVal < 0) return callback({message: 'unacceptable programming lang'});

            var data = {
                localid: probNum,
                code: '',
                language: langVal,
                codeupl: {filePath: filePath},
                problemid: '',
                category: ''
            };
            
            (req = util.createReq('POST', UVA_HOST, SUBMIT_PATH, callback10))
                .on('error', callback)
                .setHeader('Cookie', cookies);
            
            try
            {
                util.writeFormData(req, data);        
            }
            catch(e)
            {
                callback(typeof e ==='string' ? {message: e} : e);
            }
        };

        this.fetchStatus = function(num, callback){
            var tries = 0;
            function process(buf)
            {
                var obj = JSON.parse(buf);
                var subs = obj.subs; 
                
                // latest at 0th elem.
                subs.sort(function(a,b){return b[0] - a[0];});

                // must sort first then slice
                if (subs.length > num) 
                    subs = subs.slice(0, num);
                /*
                subs[i] is an array with fields in this order:
                0: Submission ID
                1: Problem ID
                2: Verdict ID
                3: Runtime
                4: Submission Time (unix timestamp)
                5: Language ID (1=ANSI C, 2=Java, 3=C++, 4=Pascal)
                6: Submission Rank
                */

                var p = adapData.probs;
                var map = adapData.map;
                var outdated = false;
                for (var i=0;i < subs.length; i++)
                {
                    var cur = subs[i];
                    var idx = map[cur[1].toString()];
                    if (p[idx])
                        cur[1] = p[idx][1];
                    else
                    {
                        cur[1] = -1;
                        outdated = true;
                        // don't break
                    }

                    cur[2] = cls.getVerdict(cur[2]);
                    cur[4] *= 1000; // convert to millisec
                    cur[5] = cls.getLang(cur[5]);
                }

                if (outdated && tries++ < 1) 
                {
                    // retry
                    adapData.probs = null;
                    return fetchProbs(function(e){
                        if (e) return callback(e);
                        process(buf);
                    });
                }

                callback(null, subs);
            }

            var callback10 = util.createEndCallback(process);

            function callback05(e)
            {
                if (e) return callback(e);

                fetchUserId(function(e2, userId){
                    if (e2) return callback(e2);

                    util.createReq(
                        'GET', 
                        UHUNT_HOST, 
                        '/api/subs-user/'+userId, 
                        callback10).on('error', callback).end();
                });
            }

            fetchProbs(callback05);
        };

        this.getProblemURL = function(probNum, callback){
            fetchProbs(function(e, probs){
                var theProb = probs[adapData.mapNum[probNum+'']];
                if (theProb)
                {
                    var probId = theProb[0];
                    callback(null, 'http://'+UVA_HOST+PROBLEM_PATH + probId);
                    return;
                }

                callback(null,null);
            });
        };
    }

    cls.parseForm = function(formPat, html){
        var match = formPat.exec(html);
        if (! match) return null;

        var attribs = match[1];
        var contents = match[2];
        var atts = util.parseAttribs(attribs);
        var r = {contents: contents, data: {}};

        for (var key in atts)
        {
            if (key.toLowerCase() === 'action')
            {
                r.action = util.htmlDecodeSimple(atts[key]);
                break;
            }
        }

        while(match = INPUT_PATTERN.exec(contents))
        {
            atts = util.parseAttribs(match[1]);
            var value = null, name = null, isText = false;

            for (var key in atts)
            {
                var val = util.htmlDecodeSimple(atts[key]);
                var keyLower = key.toLowerCase();
                var valLower = val.toLowerCase();

                switch(keyLower)
                {
                case 'type':
                    isText = (valLower === 'password' || valLower === 'text');
                    break;
                case 'name':
                    name = val;
                    break;
                case 'value':
                    value = val;
                    break; 
                }
            }
            
            if (name !== null && isText)
            {
                var nameLower = name.toLowerCase();
                if (nameLower.indexOf("user") >= 0)
                    r.userField = name;
                else if (nameLower.indexOf("pass")>=0)
                    r.passField = name;
            }
            else if (value !== null && name !== null)
            {
                r.data[name] = value; 
            }
        }

        return r;
    };

    /**
     * @param lang One of LANG_* constants
     * @return UVA lang value or -1 if unacceptable.
     */
    cls.getLangVal = function(lang){ 
        switch (lang)
        {
        case util.LANG_C: return 1; 
        case util.LANG_JAVA: return 2; 
        case util.LANG_CPP: return 3;  
        case util.LANG_PASCAL: return 4; 
        case util.LANG_CPP11: return 5;  
        }

        return -1;
    };

    cls.getVerdict = function(ver)
    {
        switch(ver)
        {
        case 10: return Adapter.STATUS_ERROR;
        case 15: return Adapter.STATUS_QUEUE_ERROR;
        case 20: return Adapter.STATUS_IN_QUEUE;
        case 30: return Adapter.STATUS_COMPILE_ERROR;
        case 35: return Adapter.STATUS_RESTRICTED_FN;
        case 40: return Adapter.STATUS_RUNTIME_ERROR;
        case 45: return Adapter.STATUS_OUTPUT_LIMIT;
        case 50: return Adapter.STATUS_TIME_LIMIT;
        case 60: return Adapter.STATUS_MEM_LIMIT;
        case 70: return Adapter.STATUS_WRONG_ANS;
        case 80: return Adapter.STATUS_PRESENTATION;
        case 90: return Adapter.STATUS_ACCEPTED;
        }

        return "?";
    };

    cls.getLang = function(id)
    {
        switch(id)
        {
        case 1: return "C";
        case 2: return "Java";
        case 3: return "C++";
        case 4: return "Pascal";
        case 5: return "C++11";
        }

        return "?";
    };

    return cls;
})(Adapter);
