import { createFileRoute } from '@tanstack/react-router';
import doc from '../../../content/symptoms/200-captcha-body.md?docs';
import { SymptomPage } from '../../components/symptom-page.js';
import { docHead } from '../../lib/doc-head.js';

export const Route = createFileRoute('/symptoms/200-captcha-body')({
	head: () => docHead(doc.title, doc.summary, '/symptoms/200-captcha-body'),
	component: () => <SymptomPage doc={doc} />,
});
