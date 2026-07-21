import { redirect } from 'next/navigation';

export default function AssetsRedirect() {
  redirect('/library?tab=assets');
}
