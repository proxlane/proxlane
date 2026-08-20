import { createFileRoute } from '@tanstack/react-router';
import doc from '../../../content/symptoms/datadome-detection.md?docs';
import { SymptomPage } from '../../components/symptom-page.js';
import { docHead } from '../../lib/doc-head.js';

export const Route = createFileRoute('/symptoms/datadome-detection')({
	head: () => docHead(doc.title, doc.summary, '/symptoms/datadome-detection'),
	component: () => <SymptomPage doc={doc} />,
});
