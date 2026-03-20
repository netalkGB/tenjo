import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
  PaginationLink
} from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';

interface HistoryPaginationProps {
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  getPageUrl?: (page: number) => string;
  skeleton?: boolean;
}

export function HistoryPagination({
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  getPageUrl = page => `?page=${page}`,
  skeleton = false
}: HistoryPaginationProps) {
  if (skeleton) {
    return (
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <Skeleton className="h-9 w-20" />
          </PaginationItem>
          {Array.from({ length: 7 }, (_, i) => (
            <PaginationItem key={i}>
              <Skeleton className="h-9 w-9" />
            </PaginationItem>
          ))}
          <PaginationItem>
            <Skeleton className="h-9 w-20" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );
  }

  const handlePageClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    page: number
  ) => {
    if (onPageChange) {
      e.preventDefault();
      onPageChange(page);
    }
  };

  // Always display a maximum of 7 slots (page numbers + ellipsis) to maintain fixed width
  const getPageNumbers = () => {
    // If totalPages is 7 or less, display all pages
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1) as (
        | number
        | 'ellipsis'
      )[];
    }

    const pages: (number | 'ellipsis')[] = [];

    if (currentPage <= 4) {
      // Near start: 1 2 3 4 5 ... last
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('ellipsis');
      pages.push(totalPages);
    } else if (currentPage >= totalPages - 3) {
      // Near end: 1 ... last-4 last-3 last-2 last-1 last
      pages.push(1);
      pages.push('ellipsis');
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      // Center: 1 ... cur-1 cur cur+1 ... last
      pages.push(1);
      pages.push('ellipsis');
      pages.push(currentPage - 1);
      pages.push(currentPage);
      pages.push(currentPage + 1);
      pages.push('ellipsis');
      pages.push(totalPages);
    }

    return pages;
  };

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href={canGoPrevious ? getPageUrl(currentPage - 1) : undefined}
            onClick={e => canGoPrevious && handlePageClick(e, currentPage - 1)}
            aria-disabled={!canGoPrevious}
          />
        </PaginationItem>

        {getPageNumbers().map((page, index) => (
          <PaginationItem key={index}>
            {page === 'ellipsis' ? (
              <PaginationEllipsis />
            ) : (
              <PaginationLink
                href={getPageUrl(page)}
                isActive={page === currentPage}
                onClick={e => handlePageClick(e, page)}
              >
                {page}
              </PaginationLink>
            )}
          </PaginationItem>
        ))}

        <PaginationItem>
          <PaginationNext
            href={canGoNext ? getPageUrl(currentPage + 1) : undefined}
            onClick={e => canGoNext && handlePageClick(e, currentPage + 1)}
            aria-disabled={!canGoNext}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
