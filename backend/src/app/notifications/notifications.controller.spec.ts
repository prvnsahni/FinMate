import { NotificationsController } from './notifications.controller';

describe('NotificationsController (BATCH-12)', () => {
  let service: {
    getNotifications: jest.Mock;
    markState: jest.Mock;
    setControl: jest.Mock;
  };
  let controller: NotificationsController;
  const req = { user: { id: 'user-9' } } as any;

  beforeEach(() => {
    service = {
      getNotifications: jest
        .fn()
        .mockResolvedValue({ notifications: [], control: 'standard' }),
      markState: jest.fn(),
      setControl: jest.fn().mockResolvedValue('off'),
    };
    controller = new NotificationsController(service as any);
  });

  it('list scopes to the authenticated user and passes the whileAway flag', async () => {
    await controller.list(req, 'true');
    expect(service.getNotifications).toHaveBeenCalledWith('user-9', true);
    const out = await controller.list(req, undefined);
    expect(service.getNotifications).toHaveBeenLastCalledWith('user-9', false);
    expect(out.data).toEqual({ notifications: [], control: 'standard' });
  });

  it('markSeen forwards the caller id and acted flag', async () => {
    await controller.markSeen(req, 'n1', { acted: true });
    expect(service.markState).toHaveBeenCalledWith('user-9', 'n1', true);
    await controller.markSeen(req, 'n2', {});
    expect(service.markState).toHaveBeenCalledWith('user-9', 'n2', false);
  });

  it('setPreferences forwards the caller id and control', async () => {
    const out = await controller.setPreferences(req, { control: 'off' });
    expect(service.setControl).toHaveBeenCalledWith('user-9', 'off');
    expect(out.data).toEqual({ control: 'off' });
  });
});
