import { newDb } from '../../server/node_modules/pg-mem/index.js';
import { buildApp } from '../../server/app.js';
import { createPlaceStore } from '../../server/store.js';
const db=newDb();const adapter=db.adapters.createPg();const pool=new adapter.Pool();const store=createPlaceStore(pool);await store.init();
const app=buildApp({store,mapConfig:{key:'test-key',securityJsCode:'test-code'}});
const server=app.listen(47831,'127.0.0.1',()=>console.log('ISOLATED_SERVER_READY http://127.0.0.1:47831'));
const stop=()=>server.close(()=>pool.end());process.on('SIGTERM',stop);process.on('SIGINT',stop);
