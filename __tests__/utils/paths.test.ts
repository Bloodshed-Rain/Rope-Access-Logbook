import { normalizeAppPath, rehydrateAppPath } from '../../src/utils/paths';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

describe('paths', () => {
  describe('normalizeAppPath', () => {
    it('strips the documentDirectory prefix', () => {
      const abs = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg';
      expect(normalizeAppPath(abs)).toBe('logbook/photos/a.jpg');
    });

    it('returns a path under logbook/ as relative even if already relative', () => {
      expect(normalizeAppPath('logbook/signatures/s1.png')).toBe('logbook/signatures/s1.png');
    });

    it('returns input unchanged when prefix does not match and is not already relative', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const weird = 'content://com.example/photo/1';
      expect(normalizeAppPath(weird)).toBe(weird);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('warns but returns input unchanged for file:// paths outside documentDirectory', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const outside = 'file:///var/mobile/OtherApp/file.jpg';
      expect(normalizeAppPath(outside)).toBe(outside);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  describe('rehydrateAppPath', () => {
    it('prepends the documentDirectory prefix to a relative path', () => {
      expect(rehydrateAppPath('logbook/photos/a.jpg')).toBe(
        'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg',
      );
    });

    it('leaves absolute paths unchanged', () => {
      const abs = 'file:///already/absolute/path.jpg';
      expect(rehydrateAppPath(abs)).toBe(abs);
    });
  });

  describe('round-trip', () => {
    it('normalize then rehydrate yields the original path', () => {
      const abs = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s.png';
      expect(rehydrateAppPath(normalizeAppPath(abs))).toBe(abs);
    });
  });
});
