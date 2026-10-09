(function(){
 // Direct-read and login integrations of the OLD Supabase project must never run.
 ['v106DirectEnabled','v124EnsureEdgeSession'].forEach(function(k){if(typeof window[k]==='function')window[k]=function(){return false}});
 ['v106EdgeLogin','v106EdgeMe'].forEach(function(k){if(typeof window[k]==='function')window[k]=async function(){return null}});
 try{localStorage.removeItem('tsiSO_soa_mode')}catch(e){}
})();

// Allow the native login request to finish before the legacy 50-second UI guard.
window.V146_AUTH_TIMEOUT_MS=120000;
