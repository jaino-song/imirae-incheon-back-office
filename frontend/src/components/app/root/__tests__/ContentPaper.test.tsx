import { render, screen } from '@testing-library/react';
import { ContentPaper } from '../ContentPaper';

describe('ContentPaper', () => {
  describe('Basic Rendering', () => {
    it('renders children correctly', () => {
      render(
        <ContentPaper>
          <div data-testid="child">Hello</div>
        </ContentPaper>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('renders with data-component attribute for testing', () => {
      render(<ContentPaper>Content</ContentPaper>);

      expect(screen.getByTestId('ContentPaper')).toHaveAttribute('data-component', 'desktop_chrome_content-paper'
      );
    });

    it('renders with empty children without error', () => {
      expect(() => render(<ContentPaper>{null}</ContentPaper>)).not.toThrow();
      expect(() => render(<ContentPaper>{undefined}</ContentPaper>)).not.toThrow();
    });

    it('renders multiple children in order', () => {
      render(
        <ContentPaper>
          <div data-testid="first">First</div>
          <div data-testid="second">Second</div>
          <div data-testid="third">Third</div>
        </ContentPaper>
      );

      expect(screen.getByTestId('first')).toBeInTheDocument();
      expect(screen.getByTestId('second')).toBeInTheDocument();
      expect(screen.getByTestId('third')).toBeInTheDocument();
    });
  });

  describe('Title and Subtitle', () => {
    it('renders title when provided', () => {
      render(<ContentPaper title="Test Title">Content</ContentPaper>);

      expect(screen.getByText('Test Title')).toBeInTheDocument();
    });

    it('renders subtitle when provided with title', () => {
      render(
        <ContentPaper title="Title" subtitle="Test Subtitle">
          Content
        </ContentPaper>
      );

      expect(screen.getByText('Test Subtitle')).toBeInTheDocument();
    });

    it('does not render title/subtitle when not provided', () => {
      render(<ContentPaper>Content</ContentPaper>);

      // When no title, CardHeader should not render
      expect(screen.queryByText('Test Title')).not.toBeInTheDocument();
    });

    it('renders title with special characters correctly', () => {
      render(
        <ContentPaper title="직원 목록 & 'Quotes'">Content</ContentPaper>
      );

      expect(screen.getByText("직원 목록 & 'Quotes'")).toBeInTheDocument();
    });
  });

  describe('Header Prop', () => {
    it('header prop overrides title/subtitle', () => {
      render(
        <ContentPaper
          title="Ignored Title"
          subtitle="Ignored Subtitle"
          header={<div data-testid="custom-header">Custom Header</div>}
        >
          Content
        </ContentPaper>
      );

      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
      expect(screen.queryByText('Ignored Title')).not.toBeInTheDocument();
      expect(screen.queryByText('Ignored Subtitle')).not.toBeInTheDocument();
    });

    it('header prop with complex ReactNode', () => {
      render(
        <ContentPaper
          header={
            <div data-testid="complex-header">
              <h2>Custom Title</h2>
              <button>Action</button>
            </div>
          }
        >
          Content
        </ContentPaper>
      );

      expect(screen.getByTestId('complex-header')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Custom Title'
      );
      expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });
  });

  describe('Animation', () => {
    it('applies animation class by default', () => {
      render(<ContentPaper>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      expect(paper).toHaveClass('animate-fade-in');
    });

    it('disableAnimation prop removes animation class', () => {
      render(
        <ContentPaper disableAnimation>Immediate Content</ContentPaper>
      );
      const paper = screen.getByTestId('ContentPaper');

      expect(paper).not.toHaveClass('animate-fade-in');
      expect(screen.getByText('Immediate Content')).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('applies rounded border radius', () => {
      render(<ContentPaper>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      expect(paper).toHaveClass('rounded-lg');
    });

    it('applies custom className', () => {
      render(
        <ContentPaper className="custom-class">Content</ContentPaper>
      );
      const paper = screen.getByTestId('ContentPaper');

      expect(paper).toHaveClass('custom-class');
    });

    it('forwards id prop', () => {
      render(<ContentPaper id="test-section">Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      expect(paper).toHaveAttribute('id', 'test-section');
    });
  });

  describe('Backwards Compatibility', () => {
    it('accepts elevation prop without error (deprecated)', () => {
      expect(() =>
        render(<ContentPaper elevation={8}>Content</ContentPaper>)
      ).not.toThrow();
    });

    it('accepts sx prop with minHeight (backwards compat)', () => {
      render(<ContentPaper sx={{ minHeight: '70vh' }}>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      expect(paper).toHaveClass('min-h-[70vh]');
    });

    it('accepts component prop without error (deprecated)', () => {
      expect(() =>
        render(<ContentPaper component="section">Content</ContentPaper>)
      ).not.toThrow();
    });
  });
});
