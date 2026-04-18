import { useCallback, useState } from 'react';
import { SupervisorSearchKind, SupervisorSearchResult } from '../types';
import { CloudClient } from '../cloud/cloudClient';

export function useSupervisorSearch(cloud: CloudClient) {
  const [results, setResults] = useState<SupervisorSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    async (kind: SupervisorSearchKind, query: string) => {
      setIsSearching(true);
      setError(null);
      try {
        const r = await cloud.searchSupervisors(kind, query);
        setResults(r);
      } catch (e) {
        setError((e as Error).message);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [cloud],
  );

  return { results, search, isSearching, error };
}
