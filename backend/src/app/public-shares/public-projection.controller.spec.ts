import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
import { PublicProjectionController } from './public-projection.controller';
import { PublicProjectionService } from './public-projection.service';
import {
  THROTTLE_POLICY_KEY,
  THROTTLE_PROFILES,
} from '../throttler/throttle.constants';

describe('PublicProjectionController (PUBLIC-1C)', () => {
  let controller: PublicProjectionController;
  let projection: { getPublicLedger: jest.Mock };

  beforeEach(async () => {
    projection = {
      getPublicLedger: jest.fn().mockResolvedValue({
        groupName: 'G',
        currency: 'INR',
        entries: [],
        balanceSummary: [],
        generatedAt: '2026-08-23T00:00:00.000Z',
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicProjectionController],
      providers: [{ provide: PublicProjectionService, useValue: projection }],
    }).compile();
    controller = module.get(PublicProjectionController);
  });

  it('24. is ANONYMOUS — no guards are attached to the controller or route', () => {
    // NestJS stores @UseGuards under '__guards__'; a JWT-guarded controller would
    // have it. The public projection route must have none.
    const classGuards = Reflect.getMetadata(
      '__guards__',
      PublicProjectionController,
    );
    const routeGuards = Reflect.getMetadata(
      '__guards__',
      PublicProjectionController.prototype.getLedger,
    );
    expect(classGuards).toBeUndefined();
    expect(routeGuards).toBeUndefined();
  });

  it('25. is rate-limited via the PUBLIC_SHARE throttle profile', () => {
    const policy = new Reflector().get(
      THROTTLE_POLICY_KEY,
      PublicProjectionController,
    );
    expect(policy).toBe(THROTTLE_PROFILES.PUBLIC_SHARE);
  });

  const mockRes = () => ({ setHeader: jest.fn() });

  it('delegates the raw path token to the projection service and wraps the result', async () => {
    const res = mockRes();
    const out = await controller.getLedger('raw-token', res);
    expect(projection.getPublicLedger).toHaveBeenCalledWith('raw-token');
    expect(out.data).toMatchObject({ groupName: 'G' });
  });

  it('propagates the generic 404 from the service unchanged', async () => {
    projection.getPublicLedger.mockRejectedValue(new NotFoundException());
    await expect(controller.getLedger('bad', mockRes())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ── PUBLIC-1G — revocable ledger must never be cached ────────────────────────
  it('26. sets Cache-Control: no-store on the SUCCESS response', async () => {
    const res = mockRes();
    await controller.getLedger('raw-token', res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('26. sets Cache-Control: no-store BEFORE the lookup, so the 404 path carries it too', async () => {
    projection.getPublicLedger.mockRejectedValue(new NotFoundException());
    const res = mockRes();
    await expect(controller.getLedger('bad', res)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Header was set before the throw → present on the generic-404 response too.
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
