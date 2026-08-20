import { createFileRoute } from '@tanstack/react-router';
import doc from '../../../content/symptoms/403-while-scraping.md?docs';
import { SymptomPage } from '../../components/symptom-page.js';
import { docHead } from '../../lib/doc-head.js';

export const Route = createFileRoute('/symptoms/403-while-scraping')({
	head: () => docHead(doc.title, doc.summary, '/symptoms/403-while-scraping'),
	component: () => <SymptomPage doc={doc} />,
});
