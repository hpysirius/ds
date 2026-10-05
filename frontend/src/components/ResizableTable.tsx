'use client';

/**
 * 表头拖拽调整列宽（零第三方依赖）
 *
 * 背景：商品库列多、字段长短差异大，写死的宽度不够用。
 * 这里用 antd Table 的 components.header.cell 覆盖表头单元格，
 * 在右侧塞一个 8px 的手柄拖动改宽度，宽度按页面 key 存 localStorage，下次进页面还在。
 *
 * 用法：
 *   const { columns, scrollX, resetWidths, customized } =
 *     useResizableColumns('products', baseColumns);
 *   <Table columns={columns} components={RESIZABLE_TABLE_COMPONENTS} scroll={{ x: scrollX }} />
 *
 * 注意事项：
 * - SSR 首帧一律用默认宽度，挂载后才读本地缓存（避免 hydration 不一致）。
 * - 自定义 props 必须以 ds 前缀命名并在 cell 里解构掉，否则会被展开到 <th> 上触发 React 警告。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

/** 列最小宽度，防止拖成一条缝找不回来 */
const MIN_WIDTH = 56;
/** localStorage key 前缀（带版本号，方便以后整体失效） */
const STORE_PREFIX = 'ds.colWidths.v1.';

export type BaseColumn = Record<string, any>;

function readStore(key: string): Record<string, number> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(STORE_PREFIX + key);
    const obj = raw ? JSON.parse(raw) : null;
    if (!obj || typeof obj !== 'object') return {};
    const out: Record<string, number> = {};
    Object.keys(obj).forEach((k) => {
      const v = Number(obj[k]);
      if (Number.isFinite(v) && v >= MIN_WIDTH) out[k] = Math.round(v);
    });
    return out;
  } catch {
    return {};
  }
}

function writeStore(key: string, widths: Record<string, number>) {
  try {
    window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify(widths));
  } catch {
    /* 隐私模式下写不进去就算了，不影响本次使用 */
  }
}

export function useResizableColumns(storageKey: string, base: BaseColumn[]) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const timer = useRef<any>(null);

  useEffect(() => {
    setWidths(readStore(storageKey));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [storageKey]);

  /** 拖动过程中高频调用，所以写盘做 300ms 防抖 */
  const setWidth = (id: string, w: number) => {
    setWidths((prev) => {
      const next = { ...prev, [id]: w };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => writeStore(storageKey, next), 300);
      return next;
    });
  };

  const resetWidths = () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      window.localStorage.removeItem(STORE_PREFIX + storageKey);
    } catch {
      /* ignore */
    }
    setWidths({});
  };

  const { columns, totalWidth } = useMemo(() => {
    let total = 0;
    const cols = base.map((c, i) => {
      // 列的稳定标识：优先手动指定的 key，其次 dataIndex，最后退化到下标
      const rawKey = c.key ?? (Array.isArray(c.dataIndex) ? c.dataIndex.join('.') : c.dataIndex);
      const id = String(rawKey ?? `__idx${i}`);
      const baseWidth = typeof c.width === 'number' ? c.width : undefined;
      const width = widths[id] ?? baseWidth;
      if (typeof width === 'number') total += width;
      return {
        ...c,
        key: c.key ?? id,
        width,
        onHeaderCell: () => ({
          dsResizable: c.resizable !== false,
          dsWidth: width,
          dsMinWidth: c.minWidth ?? MIN_WIDTH,
          dsOnResize: (next: number) => setWidth(id, next),
        }),
      };
    });
    // 断言成 any[]：onHeaderCell 返回的是我们自己的 ds* 字段，
    // 跟 antd 的 HTMLAttributes 签名对不上，没必要为它跟 TS 较劲
    return { columns: cols as any[], totalWidth: total };
  }, [base, widths]);

  return {
    columns,
    /** 给 Table 的 scroll.x：列宽总和 + 一点余量（行选择列约 32px） */
    scrollX: totalWidth + 40,
    resetWidths,
    /** 是否有过自定义调整（用来决定"还原"按钮是否可用） */
    customized: Object.keys(widths).length > 0,
  };
}

/** 可拖拽的表头单元格 */
function ResizableHeaderCell(props: any) {
  const { dsWidth, dsMinWidth = MIN_WIDTH, dsOnResize, dsResizable, className, children, ...rest } = props;
  const [dragging, setDragging] = useState(false);

  const startDrag = (e: React.MouseEvent) => {
    if (!dsOnResize || typeof dsWidth !== 'number') return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = dsWidth;
    let latest = startWidth;
    let raf = 0;

    setDragging(true);
    document.body.classList.add('ds-col-resizing');

    // mousemove 频率远高于渲染需要，用 rAF 合帧，拖起来才跟手
    const flush = () => {
      raf = 0;
      dsOnResize(latest);
    };
    const onMove = (ev: MouseEvent) => {
      latest = Math.max(dsMinWidth, Math.round(startWidth + ev.clientX - startX));
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('ds-col-resizing');
      setDragging(false);
      dsOnResize(latest);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const showHandle = dsResizable !== false && typeof dsWidth === 'number';

  return (
    <th {...rest} className={[className, showHandle ? 'ds-resizable-th' : ''].filter(Boolean).join(' ')}>
      {children}
      {showHandle && (
        <span
          className={`ds-col-resizer${dragging ? ' dragging' : ''}`}
          title="拖动调整列宽"
          onMouseDown={startDrag}
          // 阻止冒泡，否则拖完松手会顺带触发这一列的排序
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}
    </th>
  );
}

/** antd Table 的 components，直接传给 <Table components={...} /> */
export const RESIZABLE_TABLE_COMPONENTS = {
  header: { cell: ResizableHeaderCell },
};
