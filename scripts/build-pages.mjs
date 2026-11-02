import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const requested = process.env.EXPO_BASE_URL || '/robbtracker-webversion';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/.test(requested)) throw new Error('Use a valid GitHub Pages repository base path.');
const base = requested.replace(/\/$/, '');
const environment = {...process.env, EXPO_BASE_URL:base, EXPO_NO_TELEMETRY:'1'};
const expo = fileURLToPath(new URL('../node_modules/expo/bin/cli',import.meta.url));
const prepare = fileURLToPath(new URL('./prepare-pwa.mjs',import.meta.url));
for(const args of [[expo,'export','--platform','web','--output-dir','dist'],[prepare]]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env:environment,windowsHide:true});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}