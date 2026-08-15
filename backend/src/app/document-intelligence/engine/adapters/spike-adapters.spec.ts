import { defaultSpikeAdapters } from './spike-adapters';
import { AdapterKind } from './extraction-adapter.types';
import { DocumentExtractionInput } from '../document-extraction-engine.types';

const input: DocumentExtractionInput = {
  documentRef: 'att-1',
  sourceType: 'image',
  mimeType: 'image/jpeg',
};

describe('DOC-2 spike adapters (architecture, no extraction)', () => {
  const adapters = defaultSpikeAdapters();
  const kinds: AdapterKind[] = ['image', 'pdf_text', 'pdf_scanned'];

  it.each(kinds)('%s adapter returns provider_unavailable and fabricates nothing', async (kind) => {
    const out = await adapters[kind].extract(input);
    expect(out.status).toBe('provider_unavailable');
    expect(out.header).toBeUndefined();
    expect(out.lineItems).toBeUndefined();
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it.each(kinds)('%s adapter declares its required package(s) and is on-device (no external call)', (kind) => {
    const req = adapters[kind].requirement;
    expect(req.requiredPackages.length).toBeGreaterThan(0);
    expect(req.processesLocally).toBe(true);
  });
});
