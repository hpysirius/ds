'use client';

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { http } from './api';
import { isSuperAdmin } from './permissions';

export interface StoreItem {
  id: number;
  name: string;
  code?: string | null;
  remark?: string | null;
  status: string;
  userCount?: number;
  productCount?: number;
  recordCount?: number;
}

interface StoreContextValue {
  stores: StoreItem[];
  loading: boolean;
  isSuper: boolean;
  /** 当前选中店铺 id；null = 全部（仅超管可选） */
  currentStoreId: number | null;
  currentStore: StoreItem | null;
  setCurrentStoreId: (id: number | null) => void;
  /**
   * 调接口时附加的店铺参数：
   * - 超管选中某店铺 → { storeId }
   * - 超管选「全部」或未选 → {}
   * - 普通员工 → {}（后端按其自身 storeId 隔离，前端无需传）
   */
  storeParam: Record<string, any>;
  reloadStores: () => void;
}

const STORAGE_KEY = 'ds_store_id';

const StoreContext = createContext<StoreContextValue>({
  stores: [],
  loading: false,
  isSuper: false,
  currentStoreId: null,
  currentStore: null,
  setCurrentStoreId: () => {},
  storeParam: {},
  reloadStores: () => {},
});

export function StoreProvider({ user, children }: { user: any; children: ReactNode }) {
  const isSuper = isSuperAdmin(user);
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentStoreId, setCurrentStoreIdState] = useState<number | null>(null);

  // 加载店铺列表（仅超管需要切换器）
  useEffect(() => {
    if (!isSuper) {
      setStores([]);
      setCurrentStoreIdState(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    http
      .get('/stores')
      .then(({ data }) => {
        if (cancelled) return;
        setStores(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setStores([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSuper]);

  // 从 localStorage 恢复上次选中的店铺（仅超管）
  useEffect(() => {
    if (!isSuper) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const n = Number(saved);
      if (Number.isFinite(n)) setCurrentStoreIdState(n);
    }
  }, [isSuper]);

  const setCurrentStoreId = (id: number | null) => {
    setCurrentStoreIdState(id);
    if (id == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  };

  const currentStore = useMemo(
    () => stores.find((s) => s.id === currentStoreId) || null,
    [stores, currentStoreId],
  );

  const storeParam = useMemo(() => {
    if (!isSuper) return {};
    return currentStoreId != null ? { storeId: currentStoreId } : {};
  }, [isSuper, currentStoreId]);

  const value: StoreContextValue = {
    stores,
    loading,
    isSuper,
    currentStoreId,
    currentStore,
    setCurrentStoreId,
    storeParam,
    reloadStores: () => {
      if (!isSuper) return;
      setLoading(true);
      http
        .get('/stores')
        .then(({ data }) => setStores(Array.isArray(data) ? data : []))
        .catch(() => {})
        .finally(() => setLoading(false));
    },
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
