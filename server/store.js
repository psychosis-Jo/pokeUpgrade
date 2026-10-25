const fs = require('node:fs/promises');
const path = require('node:path');
const clone = x => structuredClone(x);
// Local store is deliberately single-process. Production uses database transactions.
class LocalStore {
  constructor(file) { this.file = file; this.data = { rooms: {}, profiles: {} }; this.queue = Promise.resolve(); }
  async init() {
    if (this.file) { try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  }
  async activeRooms() { return Object.values(this.data.rooms).filter(r => !r.closed && r.game && r.game.phase !== 'reward').map(r => r.code); }
  transaction(fn) {
    const run = this.queue.then(async () => {
      const next = clone(this.data);
      const tx = { get: async (kind, id) => clone(next[kind][id] || null), set: async (kind, id, value) => { next[kind][id] = clone(value); } };
      const result = await fn(tx);
      if (this.file) {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 });
        await fs.rename(this.file + '.tmp', this.file);
      }
      this.data = next; return result;
    });
    this.queue = run.catch(() => {}); return run;
  }
}
class CloudStore {
  constructor(db) { this.db = db; }
  async init() {}
  async activeRooms() {
    const codes = [];
    for (let offset = 0; ; offset += 100) {
      const { data } = await this.db.collection('upgrade_rooms').where({ closed: false }).skip(offset).limit(100).get();
      for (const r of data) if (r.game && r.game.phase !== 'reward') codes.push(r.code);
      if (data.length < 100) return codes;
    }
  }
  transaction(fn) {
    return this.db.runTransaction(async dbtx => fn({
      get: async (kind, id) => {
        try { const r = await dbtx.collection('upgrade_' + kind).doc(id).get(); return r.data || null; }
        catch (e) { if (/not exist|not found|不存在|DOCUMENT_NOT_FOUND/i.test(e.message || String(e))) return null; throw e; }
      },
      set: async (kind, id, value) => {
        const data = { ...value }; delete data._id;
        await dbtx.collection('upgrade_' + kind).doc(id).set({ data });
      },
    }));
  }
}
module.exports = { LocalStore, CloudStore };
