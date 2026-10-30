public with sharing class NoteService {
    public static void keep() {
        Booking__c row = [SELECT Id, Note__c FROM Booking__c LIMIT 1];
        row.Note__c = 'ok';
        update row;
    }
}
