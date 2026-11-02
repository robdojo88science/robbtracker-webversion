
export async function chooseProfilePhoto(purpose:'profile'|'goal'='profile'): Promise<string | null> {
  const ImagePicker = await import('expo-image-picker');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset.base64) throw new Error('This photo could not be read. Choose another image.');
  if (asset.base64.length > 4_000_000) throw new Error(`Choose a smaller ${purpose} photo, under 3 MB.`);
  // Store the small image with the profile so JSON backups also restore it on another phone.
  return `data:image/jpeg;base64,${asset.base64}`;
}
