import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EmailService } from './email.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EmailService', () => {
  const buildService = async (
    config: Record<string, string | undefined>,
  ): Promise<EmailService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();
    return module.get(EmailService);
  };

  const withKey = {
    RESEND_API_KEY: 'test_key',
    MAIL_FROM_NAME: 'Samma',
    MAIL_FROM_EMAIL: 'noreply@mail.prvnsahni.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: treat thrown errors carrying `isAxiosError` as axios errors.
    (mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (e: unknown) => !!(e as { isAxiosError?: boolean })?.isAxiosError,
    );
  });

  it('sends a branded HTML + text email via Resend on success', async () => {
    mockedAxios.post.mockResolvedValue({ data: { id: 'msg_1' } } as never);
    const service = await buildService(withKey);

    await service.sendInviteEmail(
      'friend@example.com',
      'Trip to Goa',
      'https://app.finmate.test/groups/join/abc',
      'Alice',
    );

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(body).toMatchObject({
      from: 'Samma <noreply@mail.prvnsahni.com>',
      to: 'friend@example.com',
    });
    const payload = body as { html: string; text: string; subject: string };
    expect(payload.subject).toContain('Trip to Goa');
    expect(payload.html).toContain('Samma'); // branded header
    expect(payload.html).toContain('https://app.finmate.test/groups/join/abc');
    expect(payload.text).toContain('https://app.finmate.test/groups/join/abc');
  });

  it('normalizes a mis-set formatted MAIL_FROM_EMAIL to a valid From header (no double-wrap)', async () => {
    mockedAxios.post.mockResolvedValue({ data: { id: 'msg_1' } } as never);
    // A full "Name <email>" wrongly placed in MAIL_FROM_EMAIL must not produce
    // "Samma <Samma <noreply@...>>" (Resend 422).
    const service = await buildService({
      RESEND_API_KEY: 'test_key',
      MAIL_FROM_NAME: 'Samma',
      MAIL_FROM_EMAIL: 'Samma <noreply@mail.prvnsahni.com>',
    });

    await service.sendPasswordResetEmail('user@example.com', 'https://x/reset');

    const [, body] = mockedAxios.post.mock.calls[0];
    expect(body).toMatchObject({
      from: 'Samma <noreply@mail.prvnsahni.com>',
    });
  });

  it('does not send to an invalid recipient address', async () => {
    const service = await buildService(withKey);

    await service.sendVerificationEmail('not-an-email', 'https://x/verify');

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('logs instead of sending when no API key is configured', async () => {
    const service = await buildService({ MAIL_FROM_NAME: 'Samma' });
    const logSpy = jest.spyOn(service['logger'], 'log');

    await service.sendVerificationEmail('user@example.com', 'https://x/verify');

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MOCK EMAIL]'),
    );
  });

  it('swallows a non-transient provider failure without throwing or retrying', async () => {
    mockedAxios.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'bad request' } },
    } as never);
    const service = await buildService(withKey);
    const errSpy = jest.spyOn(service['logger'], 'error');

    await expect(
      service.sendVerificationEmail('user@example.com', 'https://x/verify'),
    ).resolves.toBeUndefined();

    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // 400 => no retry
    expect(errSpy).toHaveBeenCalled();
  });

  it('retries transient (5xx) failures up to the attempt limit', async () => {
    mockedAxios.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503, data: 'unavailable' },
    } as never);
    const service = await buildService(withKey);
    jest
      .spyOn(
        service as unknown as { retryDelayMs: (n: number) => number },
        'retryDelayMs',
      )
      .mockReturnValue(0);

    await expect(
      service.sendPasswordResetEmail('user@example.com', 'https://x/reset'),
    ).resolves.toBeUndefined();

    expect(mockedAxios.post).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS
  });
});
