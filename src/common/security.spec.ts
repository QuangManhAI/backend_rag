import express from 'express';
import request from 'supertest';
import { trustProxySetting } from './security';

function ipOf(setting: ReturnType<typeof trustProxySetting>) {
  const app = express();
  app.set('trust proxy', setting);
  app.get('/', (req, res) => {
    res.json({ ip: req.ip });
  });
  return request(app).get('/').set('X-Forwarded-For', '203.0.113.9');
}

describe('trustProxySetting', () => {
  it('without a declared proxy a client cannot choose its IP, in production too', async () => {
    expect(trustProxySetting('production', 0)).toBe(false);
    const res = await ipOf(trustProxySetting('production', 0));
    expect(res.body.ip).not.toBe('203.0.113.9');
  });

  it('with a declared proxy the forwarded client IP is used', async () => {
    const res = await ipOf(trustProxySetting('production', 1));
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('development follows the deployment as well', () => {
    expect(trustProxySetting('development', 0)).toBe(false);
    expect(trustProxySetting('development', 1)).toBe(1);
  });

  it('tests keep trusting the loopback', () => {
    expect(trustProxySetting('test', 0)).toBe('loopback');
  });
});
