import { Button } from "@/components/ui/button";

interface TabNavigationProps {
  activeTab: 'documents' | 'batches' | 'analysis' | 'admin';
  setActiveTab: (tab: 'documents' | 'batches' | 'analysis' | 'admin') => void;
  isAdmin: boolean;
}

export default function TabNavigation({ activeTab, setActiveTab, isAdmin }: TabNavigationProps) {
  return (
    <div className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-8">
          <Button
            variant="link"
            onClick={() => setActiveTab('documents')}
            className={`px-1 py-4 text-sm font-medium border-b-2 ${
              activeTab === 'documents'
                ? 'border-primary text-primary' 
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            My Documents
          </Button>
          
          <Button
            variant="link"
            onClick={() => setActiveTab('batches')}
            className={`px-1 py-4 text-sm font-medium border-b-2 ${
              activeTab === 'batches'
                ? 'border-primary text-primary' 
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            Document Batches
          </Button>
          
          <Button
            variant="link"
            onClick={() => setActiveTab('analysis')}
            className={`px-1 py-4 text-sm font-medium border-b-2 ${
              activeTab === 'analysis'
                ? 'border-primary text-primary' 
                : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            Document Analysis
          </Button>
          
          {isAdmin && (
            <Button
              variant="link"
              onClick={() => setActiveTab('admin')}
              className={`px-1 py-4 text-sm font-medium border-b-2 ${
                activeTab === 'admin'
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              User Management
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
