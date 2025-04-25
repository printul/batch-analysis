import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import Header from "@/components/header";
import Footer from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft } from "lucide-react";

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

interface BatchDetailResponse {
  batch: Batch;
  documents: Document[];
}

export default function BatchDetailsPage() {
  const { user } = useAuth();
  const [_, setLocation] = useLocation();
  const [match, params] = useRoute('/batch/:batchId');
  const { toast } = useToast();
  const batchId = match ? parseInt(params.batchId) : null;

  // Redirect to login if not authenticated
  useEffect(() => {
    if (user === null) {
      setLocation('/login');
    }
  }, [user, setLocation]);

  // Fetch batch details
  const { 
    data: batchData, 
    isLoading,
    error,
    refetch
  } = useQuery<BatchDetailResponse>({
    queryKey: ['/api/document-batches', batchId],
    enabled: !!batchId,
    retry: 3,
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

  // Safely extract batch and documents
  const batch = batchData.batch;
  const documents = batchData.documents || [];

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
            <div>
              <Badge className="mr-2">Batch ID: {batch.id}</Badge>
              <Badge variant="outline">Created: {new Date(batch.createdAt).toLocaleDateString()}</Badge>
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
                        {doc.extractedText ? (
                          <pre className="whitespace-pre-wrap font-mono text-sm">{doc.extractedText}</pre>
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
      </main>
      <Footer />
    </div>
  );
}