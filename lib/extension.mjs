import {createHash} from 'node:crypto';
export function extensionId(key){
  return createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
}
export function allowedOrigin(value,port,id){
  return !value||[`http://127.0.0.1:${port}`,`http://localhost:${port}`,`chrome-extension://${id}`].includes(value);
}
