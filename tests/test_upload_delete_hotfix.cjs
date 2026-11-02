const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const migration28=fs.readFileSync(path.join(root,'supabase/migrations/202611020028_upload_inventory_pending_sku.sql'),'utf8');
const migration29=fs.readFileSync(path.join(root,'supabase/migrations/202611020029_fix_upload_delete_where.sql'),'utf8');
const start='CREATE OR REPLACE FUNCTION public.tsi_so_upload(p_store text,p_rows jsonb)';
const oldFn=migration28.slice(migration28.indexOf(start),migration28.lastIndexOf('COMMIT;'));
const newFn=migration29.slice(migration29.indexOf(start),migration29.lastIndexOf('COMMIT;'));
assert(oldFn.startsWith(start));
assert(newFn.startsWith(start));
assert(oldFn.includes('DELETE FROM pg_temp._up028_rekey;'));
assert(!newFn.includes('DELETE FROM pg_temp._up028_rekey;'));
assert(newFn.includes('TRUNCATE TABLE pg_temp._up028_rekey;'));
// A small, high-confidence change: the executable upload function must be identical
// to the v31 version aside from the temp-table cleanup statement.
assert.strictEqual(newFn,oldFn.replace('DELETE FROM pg_temp._up028_rekey;','TRUNCATE TABLE pg_temp._up028_rekey;'));
// Inventory replacement itself must still remain scoped to a single store.
assert(newFn.includes('DELETE FROM public.tsi_so_inventory WHERE store_code=p_store;'));
assert(newFn.includes('AND c.status IN (\'COUNTING\',\'RECOUNT\')'));
assert(newFn.includes('WHERE c.store_code=p_store AND c.status=\'SCHEDULED\''));
assert(newFn.includes('ON COMMIT DROP'));
// No frontend change is necessary because RPC function interface is unchanged.
const app=fs.readFileSync(path.join(root,'site/app.js'),'utf8');
assert(app.includes("rpc('upload',{p_store:state.store,p_rows:upRows})"));
console.log('Upload delete WHERE hotfix: PASS (same function except temp-table cleanup)');
