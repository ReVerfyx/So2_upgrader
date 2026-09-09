/** Помощники интеграционных тестов: подготовка базы и авторизованный клиент. */
import request from 'supertest';
import type { Express } from 'express';

export const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Клиент с сохранением cookie и автоматической подстановкой CSRF-токена. */
export class TestClient {
  private cookies: string[] = [];
  private csrfToken = '';

  constructor(private readonly app: Express) {}

  private applyCookies(response: request.Response): void {
    const raw = response.headers['set-cookie'];
    if (!raw) return;
    const list = Array.isArray(raw) ? raw : [raw];
    for (const cookie of list) {
      const [pair] = cookie.split(';');
      if (!pair) continue;
      const name = pair.split('=')[0];
      this.cookies = this.cookies.filter((existing) => existing.split('=')[0] !== name);
      this.cookies.push(pair);
      if (name === 'so2_csrf') this.csrfToken = pair.split('=')[1] ?? '';
    }
  }

  private get cookieHeader(): string {
    return this.cookies.join('; ');
  }

  public async get(url: string): Promise<request.Response> {
    const response = await request(this.app).get(url).set('Cookie', this.cookieHeader);
    this.applyCookies(response);
    return response;
  }

  public async post(url: string, body?: unknown, headers: Record<string, string> = {}): Promise<request.Response> {
    const response = await request(this.app)
      .post(url)
      .set('Cookie', this.cookieHeader)
      .set('X-CSRF-Token', this.csrfToken)
      .set(headers)
      .send(body as object);
    this.applyCookies(response);
    return response;
  }

  public async put(url: string, body?: unknown): Promise<request.Response> {
    const response = await request(this.app)
      .put(url)
      .set('Cookie', this.cookieHeader)
      .set('X-CSRF-Token', this.csrfToken)
      .send(body as object);
    this.applyCookies(response);
    return response;
  }

  public async patch(url: string, body?: unknown): Promise<request.Response> {
    const response = await request(this.app)
      .patch(url)
      .set('Cookie', this.cookieHeader)
      .set('X-CSRF-Token', this.csrfToken)
      .send(body as object);
    this.applyCookies(response);
    return response;
  }

  /** Запрос без CSRF-заголовка — для проверки защиты. */
  public async postWithoutCsrf(url: string, body?: unknown): Promise<request.Response> {
    return request(this.app).post(url).set('Cookie', this.cookieHeader).send(body as object);
  }

  public get token(): string {
    return this.csrfToken;
  }
}

/** Уникальный логин, чтобы прогоны тестов не конфликтовали. */
export function uniqueUsername(prefix = 'user'): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}
