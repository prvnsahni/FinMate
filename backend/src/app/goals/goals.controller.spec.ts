import { GoalsController } from './goals.controller';

describe('GoalsController (BATCH-11)', () => {
  let service: {
    create: jest.Mock;
    list: jest.Mock;
    get: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    project: jest.Mock;
  };
  let controller: GoalsController;
  const req = { user: { id: 'user-7' } } as any;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'g1' }),
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ id: 'g1' }),
      update: jest.fn().mockResolvedValue({ id: 'g1' }),
      remove: jest.fn().mockResolvedValue(undefined),
      project: jest.fn().mockResolvedValue({ status: 'ok' }),
    };
    controller = new GoalsController(service as any);
  });

  it('create/list/get/update/remove/projection are all scoped to the caller id', async () => {
    await controller.create({ title: 'c' } as any, req);
    expect(service.create).toHaveBeenCalledWith('user-7', { title: 'c' });

    await controller.list(req);
    expect(service.list).toHaveBeenCalledWith('user-7');

    await controller.get('g1', req);
    expect(service.get).toHaveBeenCalledWith('user-7', 'g1');

    await controller.update('g1', { version: 1 } as any, req);
    expect(service.update).toHaveBeenCalledWith('user-7', 'g1', { version: 1 });

    await controller.remove('g1', req);
    expect(service.remove).toHaveBeenCalledWith('user-7', 'g1');
  });

  it('projection parses the assumedMonthlyContribution query', async () => {
    await controller.projection('g1', req, '150');
    expect(service.project).toHaveBeenCalledWith('user-7', 'g1', 150);
    await controller.projection('g1', req, undefined);
    expect(service.project).toHaveBeenLastCalledWith('user-7', 'g1', undefined);
  });

  it('wraps results in the SuccessResponse envelope', async () => {
    const out = await controller.list(req);
    expect(out).toMatchObject({ success: true, message: expect.any(String), data: [] });
  });
});
