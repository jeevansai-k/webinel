/**
 * Minimal screen router for the popup. Each screen exports `mount(root, ctx)`
 * and may return a cleanup function.
 */
export type ScreenName =
  | 'home'
  | 'scan'
  | 'settings'
  | 'statistics'
  | 'bookmarks'
  | 'whitelist'
  | 'timeline'
  | 'advanced'
  | 'documents'
  | 'privacy'
  | 'terms';

export interface ScreenContext {
  navigate: (screen: ScreenName) => void;
  back: () => void;
}

export type Cleanup = () => void;

export type ScreenMount = (root: HTMLElement, ctx: ScreenContext) => void | Cleanup | Promise<void | Cleanup>;

export class Router {
  private current: ScreenName | null = null;
  private cleanup: Cleanup | null = null;
  private readonly history: ScreenName[] = [];

  constructor(
    private readonly outlet: HTMLElement,
    private readonly screens: Record<ScreenName, ScreenMount>,
  ) {}

  get active(): ScreenName | null {
    return this.current;
  }

  navigate = (screen: ScreenName): void => {
    if (this.current) this.history.push(this.current);
    void this.show(screen, false);
  };

  back = (): void => {
    void this.show(this.history.pop() ?? 'home', true);
  };

  async show(screen: ScreenName, isBack: boolean): Promise<void> {
    this.cleanup?.();
    this.cleanup = null;
    this.current = screen;

    const root = document.createElement('section');
    root.className = `screen screen--${screen}${isBack ? ' screen--back' : ''}`;
    root.dataset.screen = screen;
    this.outlet.replaceChildren(root);

    let result: void | Cleanup;
    try {
      result = await this.screens[screen](root, { navigate: this.navigate, back: this.back });
    } catch (error) {
      // Never leave the popup blank: show a way back instead.
      console.warn(`Webinel: could not open ${screen}`, error);
      if (this.current === screen) this.renderFailure(root, screen);
      return;
    }
    if (this.current === screen && typeof result === 'function') this.cleanup = result;
    else if (typeof result === 'function') result();
  }

  private renderFailure(root: HTMLElement, screen: ScreenName): void {
    root.innerHTML = `<div class="screen-error" role="alert">
      <strong>This screen could not load</strong>
      <span>Webinel's background service may be restarting. Try again in a moment.</span>
      <button class="btn" type="button" data-action="retry">Try again</button>
      ${screen === 'home' ? '' : '<button class="btn btn--ghost" type="button" data-action="home">Back to Home</button>'}
    </div>`;
    root.querySelector('[data-action="retry"]')?.addEventListener('click', () => void this.show(screen, false));
    root.querySelector('[data-action="home"]')?.addEventListener('click', () => {
      this.history.length = 0;
      void this.show('home', true);
    });
  }
}
