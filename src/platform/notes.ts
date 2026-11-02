import { File, Paths } from 'expo-file-system';

const MAX_IMAGE_CHARS=8_000_000,MAX_TOTAL_CHARS=12_000_000;
/** Keep source pixels intact. PNG encoding is lossless; retain the original when it is smaller. */
export async function chooseNotePhotos(existing:string[]=[]):Promise<string[]> {
  if(existing.length>=3)throw new Error('Attach up to 3 photos. Remove one before choosing another.');
  const Picker=await import('expo-image-picker');
  const result=await Picker.launchImageLibraryAsync({mediaTypes:['images'],allowsMultipleSelection:true,selectionLimit:3-existing.length,quality:1,preferredAssetRepresentationMode:Picker.UIImagePickerPreferredAssetRepresentationMode.Current});
  if(result.canceled)return existing;
  const photos=[...existing];
  for(const asset of result.assets){
    if(asset.width*asset.height>24_000_000)throw new Error('This photo is too large to attach at full resolution. Crop to the receipt or note in Photos first.');
    const original=new File(asset.uri),mime=asset.mimeType?.toLowerCase()??(/\.png$/i.test(asset.uri)?'image/png':'image/jpeg');
    let selected:string|null=null;
    if(['image/jpeg','image/png','image/webp'].includes(mime)&&original.size<=6_000_000)selected=`data:${mime};base64,${await original.base64()}`;
    const Manipulator=await import('expo-image-manipulator');
    const context=Manipulator.ImageManipulator.manipulate(asset.uri);
    let output:InstanceType<typeof File>|undefined;
    try{
      const image=await context.renderAsync();
      try{const encoded=await image.saveAsync({format:Manipulator.SaveFormat.PNG,compress:1,base64:true});output=new File(encoded.uri);const png=encoded.base64?`data:image/png;base64,${encoded.base64}`:null;if(png&&(!selected||png.length<selected.length))selected=png;}
      finally{image.release();}
    }finally{context.release();if(output?.uri.startsWith(Paths.cache.uri)&&output.exists)output.delete();}
    if(!selected||selected.length>MAX_IMAGE_CHARS)throw new Error('This image cannot fit without reducing its quality. Crop to the readable note or receipt in Photos and try again.');
    photos.push(selected);
    if(photos.reduce((sum,photo)=>sum+photo.length,0)>MAX_TOTAL_CHARS)throw new Error('These photos are too large together. Keep the clearest receipt area or attach fewer photos.');
  }
  return photos;
}
