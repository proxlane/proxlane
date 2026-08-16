import { createFileRoute } from '@tanstack/react-router';
import doc from '../../../content/docs/adapters.md?docs';
import { DocPage, Prose } from '../../components/doc-page.js';
import { docHead } from '../../lib/doc-head.js';

export const Route = createFileRoute('/docs/adapters')({
	head: () => docHead(doc.title, doc.summary, '/docs/adapters'),
	component: () => (
		<DocPage title={doc.title} summary={doc.summary} headings={doc.headings}>
			<Prose html={doc.html} />
		</DocPage>
	),
});
