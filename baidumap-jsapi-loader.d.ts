/**
 * `@baidumap/jsapi-loader` 模块声明。
 *
 * bun 安装该依赖时会丢失其 `types/index.d.ts`（复现于 bun 1.4.2，官方与镜像源均如此），
 * 导致 `nuxt typecheck` 报 TS7016。此处按上游同名文件内容提供 ambient 声明，
 * 使依赖类型是否落盘不再影响类型检查结果。
 */
declare module '@baidumap/jsapi-loader' {
  /**
   * @baidumap/jsapi-loader 类型声明
   */

  export type BMapVersion = '3.0' | 'gl' | '4.0';

  export type BMapLoaderStatus = 'notload' | 'loading' | 'loaded' | 'failed';

  /**
   * 创建地图前需在全局命名空间上声明的配置。
   * 这些字段会在 load 完成、resolve 之前写到 BMapGL/BMap 上，
   * 从而保证在 `new BMap(GL).Map()` 之前生效。
   */
  export interface BMapLoaderGlobalConfig {
    /** 4.0 下回退 API 行为，如 'gl' */
    apiVersion?: string;
    /** 4.0 下回退 UI 样式，如 'gl' */
    uiVersion?: string;
    /** 全局坐标系标识，如 'bd09ll' / 'gcj02' */
    coordType?: string;
  }

  export interface BMapLoaderOptions {
    /** 开发者密钥。非代理模式必填 */
    ak?: string;
    /** JSAPI 版本，默认 '4.0' */
    version?: BMapVersion;
    /** 代理模式服务地址（末尾需带 "/"）。设置后启用代理，且 URL 不携带 ak */
    serviceHost?: string;
    /** 协议，默认 'https' */
    protocol?: 'https' | 'http';
    /** 加载超时（毫秒），默认 0 表示不超时 */
    timeout?: number;
    /** 创建地图前需全局声明的配置 */
    globalConfig?: BMapLoaderGlobalConfig;
  }

  /**
   * 加载百度地图 JSAPI。
   * @returns 对应版本的命名空间对象（3.0/4.0 → window.BMap，gl → window.BMapGL）
   */
  export function load(options?: BMapLoaderOptions): Promise<unknown>;

  /** 清空内部状态并移除全局对象，便于单测与热更新 */
  export function reset(): void;

  /** 查询当前加载状态 */
  export function getStatus(): BMapLoaderStatus;

  declare const _default: {
    load: typeof load;
    reset: typeof reset;
    getStatus: typeof getStatus;
  };

  export default _default;
}
