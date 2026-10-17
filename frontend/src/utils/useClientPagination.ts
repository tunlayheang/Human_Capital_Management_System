import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_LIST_PAGE_SIZE, visiblePages } from './visiblePages';

export type ClientPaginationResult<T> = {
  pageItems: T[];
  currentPage: number;
  setCurrentPage: (page: number | ((prev: number) => number)) => void;
  totalCount: number;
  totalPages: number;
  showingFrom: number;
  showingTo: number;
  pagesWindow: number[];
  pageSize: number;
  resetPage: () => void;
};

/**
 * Client-side pagination for filtered arrays. Resets to page 1 when item count or resetKey changes.
 */
export function useClientPagination<T>(
  items: T[],
  pageSize: number = DEFAULT_LIST_PAGE_SIZE,
  resetKey?: string | number
): ClientPaginationResult<T> {
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [resetKey, items.length]);

  const totalCount = items.length;
  const totalPages = totalCount === 0 ? 1 : Math.ceil(totalCount / pageSize);
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const start = (safePage - 1) * pageSize;
  const pageItems = useMemo(
    () => items.slice(start, start + pageSize),
    [items, start, pageSize]
  );

  const showingFrom = totalCount === 0 ? 0 : start + 1;
  const showingTo = totalCount === 0 ? 0 : Math.min(start + pageSize, totalCount);

  const pagesWindow = useMemo(
    () => visiblePages(safePage, totalPages, 5),
    [safePage, totalPages]
  );

  const resetPage = () => setCurrentPage(1);

  return {
    pageItems,
    currentPage: safePage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
    pageSize,
    resetPage,
  };
}
