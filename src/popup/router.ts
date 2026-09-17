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

    const result = await this.screens[screen](root, { navigate: this.navigate, back: this.back });
    if (this.current === screen && typeof result === 'function') this.cleanup = result;
    else if (typeof result === 'function') result();
  }
}
