import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseHandler } from '../netlify/functions/cloud-supabase.mjs';
import { createSelectionHandler } from '../netlify/functions/cloud-selection.mjs';

test('retired source routes require authentication and never inspect private bodies', async () => {
  for (const [create, methods] of [[createSupabaseHandler, ['POST']], [createSelectionHandler, ['GET', 'PUT']]]) {
    let authentications = 0;
    const handler = create({ authenticate: async () => { authentications++; return { id: 'synthetic' }; } });
    for (const httpMethod of methods) {
      const event = { httpMethod, get body() { assert.fail('retired route must not parse private payload'); } };
      const response = await handler(event);
      assert.equal(response.statusCode, 410);
      assert.equal(JSON.parse(response.body).error, 'private_runner_setup_required');
      assert.doesNotMatch(response.body, /token|sbp_|projectRef|excludeTables/);
      const denied = await create({ authenticate: async () => { throw new Error('private diagnostic'); } })(event);
      assert.equal(denied.statusCode, 401); assert.doesNotMatch(denied.body, /private diagnostic/);
    }
    assert.equal(authentications, methods.length);
    assert.equal((await handler({ httpMethod: 'OPTIONS' })).statusCode, 204);
    assert.equal((await handler({ httpMethod: 'DELETE' })).statusCode, 405);
    assert.equal(authentications, methods.length);
  }
});
