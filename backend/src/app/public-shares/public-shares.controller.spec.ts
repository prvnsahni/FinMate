import { Test, TestingModule } from '@nestjs/testing';
import { PublicSharesController } from './public-shares.controller';
import { PublicSharesService } from './public-shares.service';

const GROUP = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const req = { user: { id: 'user-1' } } as unknown as Request & {
  user: { id: string };
};

describe('PublicSharesController (PUBLIC-1B)', () => {
  let controller: PublicSharesController;
  let service: {
    create: jest.Mock;
    getStatus: jest.Mock;
    regenerate: jest.Mock;
    revoke: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ token: 'raw', status: 'active' }),
      getStatus: jest.fn().mockResolvedValue({ active: true, status: 'active' }),
      regenerate: jest.fn().mockResolvedValue({ token: 'raw2', status: 'active' }),
      revoke: jest.fn().mockResolvedValue({ revoked: true }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicSharesController],
      providers: [{ provide: PublicSharesService, useValue: service }],
    }).compile();
    controller = module.get(PublicSharesController);
  });

  it('POST delegates create with route groupId + caller id, returns the token once', async () => {
    const res = await controller.create(GROUP, {}, req);
    expect(service.create).toHaveBeenCalledWith('user-1', GROUP, {});
    expect(res.data).toMatchObject({ token: 'raw', status: 'active' });
  });

  it('GET delegates status and never surfaces a token/hash from the service shape', async () => {
    const res = await controller.status(GROUP, req);
    expect(service.getStatus).toHaveBeenCalledWith('user-1', GROUP);
    expect(res.data).not.toHaveProperty('tokenHash');
  });

  it('POST /regenerate delegates regenerate', async () => {
    const res = await controller.regenerate(GROUP, {}, req);
    expect(service.regenerate).toHaveBeenCalledWith('user-1', GROUP, {});
    expect(res.data).toMatchObject({ token: 'raw2' });
  });

  it('DELETE delegates revoke', async () => {
    const res = await controller.revoke(GROUP, req);
    expect(service.revoke).toHaveBeenCalledWith('user-1', GROUP);
    expect(res.data).toEqual({ revoked: true });
  });
});
