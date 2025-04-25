import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import Header from "@/components/header";
import Footer from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, BarChart3, Trash2, Pencil } from "lucide-react";
import EditBatchModal from "@/components/edit-batch-modal";

// Define types for the batch details response
interface Document {
  id: number;
  batchId: number;
  filename: string;
  fileType: string;
  filePath: string;
  extractedText?: string;
  createdAt: string;
}

interface Batch {
  id: number;
  name: string;
  description: string;
  userId: number;
  createdAt: string;
}

interface Analysis {
  id: number;
  batchId: number;
  summary: string;
  themes: string[];
  tickers?: string[];
  recommendations?: string[];
  sentimentScore: number;
  sentimentLabel: string;
  sentimentConfidence: number;
  sharedIdeas?: string[];
  divergingIdeas?: string[];
  keyPoints: string[];
  createdAt: string;
}

interface BatchDetailResponse {
  batch: Batch;
  documents: Document[];
  analysis?: Analysis;
}

export default function BatchDetailsPage() {
  const { user, isLoading: userLoading } = useAuth();
  
  console.log("Auth state:", { user, userLoading });
  const [_, setLocation] = useLocation();
  const [match, params] = useRoute('/batch/:batchId');
  const { toast } = useToast();
  const batchId = match ? parseInt(params.batchId) : null;
  
  // State for the edit batch modal
  const [isEditBatchModalOpen, setIsEditBatchModalOpen] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (user === null) {
      setLocation('/login');
    }
  }, [user, setLocation]);

  // Fetch batch details with custom queryFn to ensure proper URL construction
  const { 
    data: batchData, 
    isLoading,
    error,
    refetch
  } = useQuery<BatchDetailResponse>({
    queryKey: ['batchDetails', batchId],
    enabled: !!batchId,
    retry: 3,
    queryFn: async () => {
      if (!batchId) {
        throw new Error("No batch ID provided");
      }
      
      if (!user) {
        throw new Error("Authentication required");
      }
      
      console.log(`Fetching batch details for ID: ${batchId}, User: ${user.id} (${user.username})`);
      const response = await fetch(`/api/document-batches/${batchId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error response: ${response.status}`, errorText);
        throw new Error(`Failed to load batch: ${response.status} ${errorText}`);
      }
      
      const data = await response.json();
      console.log("Batch data received:", data);
      return data;
    },
    onError: (error) => {
      console.error("Error fetching batch details:", error);
      toast({
        title: "Error loading batch",
        description: error instanceof Error ? error.message : "Failed to load batch details",
        variant: "destructive",
      });
    }
  });

  if (!user) {
    return <div className="p-8 text-center">Redirecting to login...</div>;
  }

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50">
        <Header user={user} />
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !batchData || !batchData.batch) {
    console.error("Batch data error:", error);
    console.log("Batch data:", batchData);
    return (
      <div className="flex flex-col min-h-screen bg-gray-50">
        <Header user={user} />
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-700 mb-2">Batch Not Found</h2>
            <p className="text-gray-500 mb-6">The selected batch could not be found or you don't have permission to access it</p>
            <Button onClick={() => setLocation('/dashboard')}>Go to Dashboard</Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Safely extract batch, documents and analysis
  const batch = batchData.batch;
  const documents = batchData.documents || [];
  const analysis = batchData.analysis;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Header user={user} />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="mb-6">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setLocation('/dashboard')}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
          </Button>
          
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{batch.name}</h1>
              <p className="text-gray-500">{batch.description}</p>
            </div>
            <div className="flex items-center gap-4">
              <div>
                <Badge className="mr-2">Batch ID: {batch.id}</Badge>
                <Badge variant="outline">Created: {new Date(batch.createdAt).toLocaleDateString()}</Badge>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline"
                  onClick={() => setIsEditBatchModalOpen(true)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button 
                  variant="destructive"
                  onClick={async () => {
                    if (confirm(`Are you sure you want to delete the entire batch "${batch.name}" and all its documents? This cannot be undone.`)) {
                      try {
                        const response = await fetch(`/api/document-batches/${batch.id}`, {
                          method: 'DELETE',
                          credentials: 'include'
                        });
                        
                        if (!response.ok) {
                          const errorText = await response.text();
                          throw new Error(`Failed to delete batch: ${errorText}`);
                        }
                        
                        toast({
                          title: "Batch deleted",
                          description: "The batch and all its documents have been deleted successfully."
                        });
                        
                        // Invalidate the batches query to ensure the dashboard updates
                        queryClient.invalidateQueries({ queryKey: ['/api/document-batches'] });
                        
                        // Redirect to dashboard
                        setLocation('/dashboard');
                      } catch (error) {
                        console.error("Error deleting batch:", error);
                        toast({
                          title: "Error deleting batch",
                          description: error instanceof Error ? error.message : "An unknown error occurred",
                          variant: "destructive"
                        });
                      }
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Batch
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Documents in this Batch</CardTitle>
            <CardDescription>All documents uploaded to this batch</CardDescription>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-gray-500 mb-2">No documents found in this batch</p>
                <Button variant="outline" onClick={() => setLocation('/dashboard')}>
                  Go to Dashboard to Upload
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Document ID</th>
                      <th className="text-left p-2">Filename</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Uploaded On</th>
                      <th className="text-left p-2">Text Extracted</th>
                      <th className="text-left p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id} className="border-b hover:bg-gray-50">
                        <td className="p-2">{doc.id}</td>
                        <td className="p-2 font-medium">{doc.filename}</td>
                        <td className="p-2">
                          <Badge variant="outline">{doc.fileType.toUpperCase()}</Badge>
                        </td>
                        <td className="p-2">{new Date(doc.createdAt).toLocaleString()}</td>
                        <td className="p-2">
                          {doc.extractedText ? (
                            <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-200">Yes</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-100 text-red-800 hover:bg-red-200">No</Badge>
                          )}
                        </td>
                        <td className="p-2">
                          <Button 
                            variant="destructive"
                            size="sm"
                            onClick={async () => {
                              if (confirm(`Are you sure you want to delete the document "${doc.filename}"? This cannot be undone.`)) {
                                try {
                                  const response = await fetch(`/api/documents/${doc.id}`, {
                                    method: 'DELETE',
                                    credentials: 'include'
                                  });
                                  
                                  if (!response.ok) {
                                    const errorText = await response.text();
                                    throw new Error(`Failed to delete document: ${errorText}`);
                                  }
                                  
                                  toast({
                                    title: "Document deleted",
                                    description: "The document has been deleted successfully."
                                  });
                                  
                                  // Invalidate queries to ensure all views update
                                  queryClient.invalidateQueries({ queryKey: ['/api/document-batches'] });
                                  
                                  // Refresh the data for this page
                                  refetch();
                                } catch (error) {
                                  console.error("Error deleting document:", error);
                                  toast({
                                    title: "Error deleting document",
                                    description: error instanceof Error ? error.message : "An unknown error occurred",
                                    variant: "destructive"
                                  });
                                }
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {documents.length > 0 && (
          <div className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Document Preview</CardTitle>
                <CardDescription>Preview of extracted text from documents</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={documents[0]?.id.toString()}>
                  <TabsList className="mb-4 flex flex-wrap">
                    {documents.map((doc) => (
                      <TabsTrigger key={doc.id} value={doc.id.toString()}>
                        {doc.filename}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  
                  {documents.map((doc) => (
                    <TabsContent key={doc.id} value={doc.id.toString()}>
                      <div className="border rounded-md p-4 bg-gray-50 overflow-auto max-h-96">
                        {doc.extractedText && doc.extractedText.trim() ? (
                          <div>
                            {doc.extractedText.startsWith('%PDF') || doc.extractedText.includes('/Type /Catalog') ? (
                              <div className="p-4 bg-amber-50 border border-amber-200 rounded mb-4">
                                <p className="text-amber-700 font-medium">This PDF contains binary data that cannot be displayed properly.</p>
                                <p className="text-amber-600 text-sm mt-1">The text extraction process may need to be adjusted for this document type.</p>
                              </div>
                            ) : null}
                            <pre className="whitespace-pre-wrap font-mono text-sm">
                              {doc.extractedText.length > 10000 
                                ? doc.extractedText.substring(0, 10000) + "... [Content truncated for display. Full text is available for analysis]" 
                                : doc.extractedText}
                            </pre>
                          </div>
                        ) : (
                          <p className="text-gray-500 italic">No text has been extracted from this document yet</p>
                        )}
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Analysis Results Section */}
        {analysis && (
          <div className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Analysis Results</CardTitle>
                <CardDescription>
                  AI analysis of documents in this batch
                  <span className="ml-2 text-xs text-gray-500">
                    (Analyzed on {new Date(analysis.createdAt).toLocaleString()})
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="text-md font-medium mb-2">Summary</h3>
                  <div className="bg-gray-50 p-4 rounded-md">
                    <p className="text-sm">{analysis.summary}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-md font-medium mb-2">Themes</h3>
                    <div className="flex flex-wrap gap-2">
                      {analysis.themes.map((theme, i) => (
                        <Badge key={i} variant="outline" className="bg-blue-50 text-blue-700">
                          {theme}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  {analysis.tickers && analysis.tickers.length > 0 && (
                    <div>
                      <h3 className="text-md font-medium mb-2">Financial Tickers</h3>
                      <div className="flex flex-wrap gap-2">
                        {analysis.tickers.map((ticker, i) => (
                          <Badge key={i} variant="outline" className="bg-green-50 text-green-700 font-mono">
                            ${ticker}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <h3 className="text-md font-medium mb-2">Sentiment Analysis</h3>
                    <div className="flex items-center space-x-4">
                      <div className="bg-gray-100 p-2 rounded-md">
                        <span className="font-semibold">{analysis.sentimentLabel.toUpperCase()}</span>
                        <span className="ml-2 text-sm">
                          (Score: {analysis.sentimentScore}/5, Confidence: {Math.round(analysis.sentimentConfidence * 100)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {analysis.recommendations && analysis.recommendations.length > 0 && (
                    <div>
                      <h3 className="text-md font-medium mb-2">Recommendations</h3>
                      <ul className="list-disc list-inside space-y-1">
                        {analysis.recommendations.map((rec, i) => (
                          <li key={i} className="text-sm">{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {analysis.sharedIdeas && analysis.sharedIdeas.length > 0 && (
                    <div>
                      <h3 className="text-md font-medium mb-2">Shared Ideas</h3>
                      <ul className="list-disc list-inside space-y-1">
                        {analysis.sharedIdeas.map((idea, i) => (
                          <li key={i} className="text-sm">{idea}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {analysis.divergingIdeas && analysis.divergingIdeas.length > 0 && (
                    <div>
                      <h3 className="text-md font-medium mb-2">Diverging Ideas</h3>
                      <ul className="list-disc list-inside space-y-1">
                        {analysis.divergingIdeas.map((idea, i) => (
                          <li key={i} className="text-sm">{idea}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                
                <div>
                  <h3 className="text-md font-medium mb-2">Key Points</h3>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.keyPoints.map((point, i) => (
                      <li key={i} className="text-sm">{point}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Analysis Button Section */}
        {documents.length > 0 && !analysis && (
          <div className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Analyze Documents</CardTitle>
                  <CardDescription>Run AI analysis on all documents in this batch</CardDescription>
                </div>
                <Button 
                  onClick={async () => {
                    try {
                      // Check if any documents have text first
                      const hasExtractedText = documents.some(doc => doc.extractedText && doc.extractedText.trim());
                      
                      if (!hasExtractedText) {
                        toast({
                          title: "No text to analyze",
                          description: "None of the documents in this batch have extracted text. Please wait for text extraction to complete.",
                          variant: "destructive"
                        });
                        return;
                      }
                      
                      toast({
                        title: "Starting analysis",
                        description: "Analyzing documents in batch. This may take a moment...",
                      });
                      
                      const response = await fetch(`/api/document-batches/${batchId}/analyze`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        credentials: 'include'
                      });
                      
                      if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Analysis failed: ${errorText}`);
                      }
                      
                      const result = await response.json();
                      
                      toast({
                        title: "Analysis complete",
                        description: "Document analysis has been completed successfully. Refreshing data...",
                      });
                      
                      // Refresh the data
                      refetch();
                    } catch (error) {
                      console.error("Error analyzing documents:", error);
                      toast({
                        title: "Analysis failed",
                        description: error instanceof Error ? error.message : "An unknown error occurred",
                        variant: "destructive"
                      });
                    }
                  }}
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Analyze Batch
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  AI analysis will examine all documents in this batch and extract:
                </p>
                <ul className="mt-2 space-y-1 text-sm text-gray-600 list-disc list-inside">
                  <li>Common themes across documents</li>
                  <li>Shared and diverging ideas</li>
                  <li>Financial tickers mentioned</li>
                  <li>Overall sentiment analysis</li>
                  <li>Key recommendations</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        )}
        
        {/* Re-Analyze Button Section if analysis already exists */}
        {documents.length > 0 && analysis && (
          <div className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Re-analyze Documents</CardTitle>
                  <CardDescription>Run a new AI analysis on all documents in this batch</CardDescription>
                </div>
                <Button 
                  onClick={async () => {
                    try {
                      const hasExtractedText = documents.some(doc => doc.extractedText && doc.extractedText.trim());
                      
                      if (!hasExtractedText) {
                        toast({
                          title: "No text to analyze",
                          description: "None of the documents in this batch have extracted text.",
                          variant: "destructive"
                        });
                        return;
                      }
                      
                      toast({
                        title: "Starting new analysis",
                        description: "Re-analyzing documents in batch. This may take a moment...",
                      });
                      
                      const response = await fetch(`/api/document-batches/${batchId}/analyze`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        credentials: 'include'
                      });
                      
                      if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Analysis failed: ${errorText}`);
                      }
                      
                      const result = await response.json();
                      
                      toast({
                        title: "Analysis complete",
                        description: "Document analysis has been completed successfully. Refreshing data...",
                      });
                      
                      // Refresh the data
                      refetch();
                    } catch (error) {
                      console.error("Error analyzing documents:", error);
                      toast({
                        title: "Analysis failed",
                        description: error instanceof Error ? error.message : "An unknown error occurred",
                        variant: "destructive"
                      });
                    }
                  }}
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Re-analyze
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  This will create a new analysis of all documents in this batch, replacing the current analysis.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <Footer />
      
      {/* Edit Batch Modal */}
      <EditBatchModal 
        isOpen={isEditBatchModalOpen}
        onClose={() => setIsEditBatchModalOpen(false)}
        batch={batch}
      />
    </div>
  );
}