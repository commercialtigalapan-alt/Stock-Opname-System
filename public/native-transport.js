/* Google-shaped browser interface implemented entirely by the native HTTP server.
   No Apps Script URL, runtime, SDK, or account is used. */
(function(){
  function runner(success,failure,userObject){
    return new Proxy({}, {get:function(_,name){
      if(name==='withSuccessHandler')return function(fn){return runner(fn,failure,userObject)};
      if(name==='withFailureHandler')return function(fn){return runner(success,fn,userObject)};
      if(name==='withUserObject')return function(v){return runner(success,failure,v)};
      if(name==='then')return undefined;
      return function(){
        var args=Array.from(arguments),controller=new AbortController(),timer=setTimeout(function(){controller.abort()},125000);
        fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({method:String(name),args:args}),signal:controller.signal})
          .then(async function(r){var data=await r.json();if(!r.ok)throw new Error(data.error||'Permintaan gagal');return data})
          .then(function(data){if(success)success(data,userObject)})
          .catch(function(e){if(failure)failure(e,userObject);else console.error(e)})
          .finally(function(){clearTimeout(timer)});
      };
    }});
  }
  window.google=window.google||{};window.google.script=window.google.script||{};
  window.google.script.run=runner();
  window.google.script.host={close:function(){},setHeight:function(){},setWidth:function(){}};
  // Secure file downloads are authorized by an HttpOnly session cookie.
})();
