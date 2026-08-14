import { createFileRoute } from '@tanstack/react-router';
import doc from '../../../content/docs/failover.md?docs';
import { DocPage, Prose } from '../../components/doc-page.js';
import { docHead } from '../../lib/doc-head.js';

export const Route = createFileRoute('/docs/failover')({
	head: () => docHead(doc.title, doc.summary, '/docs/failover'),
	component: () => (
		<DocPage title={doc.title} summary={doc.summary} headings={doc.headings}>
			<Prose html={doc.html} />
		</DocPage>
	),
});
