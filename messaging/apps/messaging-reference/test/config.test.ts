import test from 'node:test'
import assert from 'node:assert/strict'
import {validateConfig} from '../src/connection.ts'
test('trusted configuration accepts HTTPS or separate loopback origins',()=>{
  assert.deepEqual(validateConfig({agentUrl:'http://127.0.0.1:4201/',relayUrl:'http://127.0.0.1:4201/'},'http://127.0.0.1:4200'),{agentUrl:'http://127.0.0.1:4201/',relayUrl:'http://127.0.0.1:4201'})
  assert.equal(validateConfig({agentUrl:'https://agent.example/',relayUrl:'https://relay.example/'},'https://app.example').relayUrl,'https://relay.example')
})
test('configuration refuses shared agent origin, remote cleartext and URL credentials',()=>{
  assert.throws(()=>validateConfig({agentUrl:'https://app.example/',relayUrl:'https://relay.example/'},'https://app.example'),/separate secure origin/)
  assert.throws(()=>validateConfig({agentUrl:'http://agent.example/',relayUrl:'https://relay.example/'},'https://app.example'),/separate secure origin/)
  assert.throws(()=>validateConfig({agentUrl:'https://user:password@agent.example/',relayUrl:'https://relay.example/'},'https://app.example'),/separate secure origin/)
  assert.throws(()=>validateConfig({agentUrl:'https://agent.example/#preselected',relayUrl:'https://relay.example/'},'https://app.example'),/separate secure origin/)
})
