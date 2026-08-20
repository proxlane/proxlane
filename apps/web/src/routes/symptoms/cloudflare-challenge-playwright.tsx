import { createFileRoute } from '@tanstack/react-router';
import doc from '../../../content/symptoms/cloudflare-challenge-playwright.md?docs';
import { SymptomPage } from '../../components/symptom-page.js';
import { docHead } from '../../lib/doc-head.js';

export const Route = createFileRoute('/symptoms/cloudflare-challenge-playwright')({
	head: () => docHead(doc.title, doc.summary, '/symptoms/cloudflare-challenge-playwright'),
	component: () => <SymptomPage doc={doc} />,
});
